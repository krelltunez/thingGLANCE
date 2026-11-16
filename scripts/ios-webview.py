#!/usr/bin/env python3
"""Evaluates JavaScript in the app's WebView in a booted iOS simulator.

  scripts/ios-webview.py <device> <bundle id> '<expression>' ['<expression>' ...]
  scripts/ios-webview.py <device> <bundle id> -        (one expression per line on stdin)

  scripts/ios-webview.py 'iPhone 17' com.thingglance.app 'Capacitor.Plugins.Reminders.pending()'

Each expression's value is printed as JSON; a promise is awaited first. With
"-" every line read is answered with one line, {"ok": value} or
{"error": message}, so a script can keep one connection open for a whole run.
That matters: the simulator makes a new connection wait about ten seconds
when it follows another, so many separate calls are slow.

It is the iOS stand-in for what scripts/android-check.mjs does over Chrome's
debugging port (docs/ios.md). It speaks the Web Inspector's own wire protocol
to the simulator's webinspectord: binary property lists, each behind a
four-byte length, on the unix socket the simulator names in
RWI_LISTEN_SOCKET. Nothing to install. Only a debug build's WebView is
inspectable.
"""
import json, plistlib, socket, struct, subprocess, sys, time, uuid

def main():
    if len(sys.argv) < 4: raise SystemExit(__doc__)
    device, bundle, expressions = sys.argv[1], sys.argv[2], sys.argv[3:]
    # Long enough for a connection that follows another one.
    timeout = 30
    path = subprocess.check_output(['xcrun', 'simctl', 'getenv', device, 'RWI_LISTEN_SOCKET'], text=True).strip()
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(path)
    sock.settimeout(timeout)
    conn = str(uuid.uuid4()).upper()
    sender = str(uuid.uuid4()).upper()

    def send(selector, **args):
        body = plistlib.dumps({'__selector': selector, '__argument': {'WIRConnectionIdentifierKey': conn, **args}}, fmt=plistlib.FMT_BINARY)
        sock.sendall(struct.pack('>I', len(body)) + body)

    def read_exact(n):
        buf = b''
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk: raise EOFError('inspector closed the connection')
            buf += chunk
        return buf

    deadline = time.time() + timeout

    def recv():
        if time.time() > deadline: raise SystemExit('timed out waiting for the WebView to answer')
        (n,) = struct.unpack('>I', read_exact(4))
        msg = plistlib.loads(read_exact(n))
        return msg.get('__selector'), msg.get('__argument', {})

    send('_rpc_reportIdentifier:')
    app = page = None
    asked = False
    while page is None:
        sel, arg = recv()
        if sel == '_rpc_reportConnectedApplicationList:':
            for a in arg.get('WIRApplicationDictionaryKey', {}).values():
                if a.get('WIRApplicationBundleIdentifierKey') == bundle: app = a['WIRApplicationIdentifierKey']
        elif sel in ('_rpc_applicationConnected:', '_rpc_applicationUpdated:'):
            if arg.get('WIRApplicationBundleIdentifierKey') == bundle: app = arg['WIRApplicationIdentifierKey']
        elif sel == '_rpc_applicationSentListing:' and arg.get('WIRApplicationIdentifierKey') == app:
            for p in arg.get('WIRListingKey', {}).values():
                if p.get('WIRTypeKey') in ('WIRTypeWebPage', 'WIRTypeWeb', 'WIRTypePage'): page = p['WIRPageIdentifierKey']
        if app and not asked:
            send('_rpc_forwardGetListing:', WIRApplicationIdentifierKey=app)
            asked = True

    send('_rpc_forwardSocketSetup:', WIRApplicationIdentifierKey=app, WIRPageIdentifierKey=page, WIRSenderKey=sender, WIRAutomaticallyPause=False)

    def send_json(obj):
        send('_rpc_forwardSocketData:', WIRApplicationIdentifierKey=app, WIRPageIdentifierKey=page, WIRSenderKey=sender, WIRSocketDataKey=json.dumps(obj).encode())

    def recv_json():
        while True:
            sel, arg = recv()
            if sel == '_rpc_applicationSentData:':
                return json.loads(arg['WIRMessageDataKey'])

    # The page's own target: commands to it travel wrapped in the Target domain.
    target = None
    while target is None:
        m = recv_json()
        if m.get('method') == 'Target.targetCreated' and m['params']['targetInfo'].get('type') == 'page':
            target = m['params']['targetInfo']['targetId']

    serial = [0]

    def call(method, params):
        serial[0] += 1
        n = serial[0]
        send_json({'id': 1000 + n, 'method': 'Target.sendMessageToTarget', 'params': {'targetId': target, 'message': json.dumps({'id': n, 'method': method, 'params': params})}})
        while True:
            m = recv_json()
            if m.get('method') != 'Target.dispatchMessageFromTarget': continue
            reply = json.loads(m['params']['message'])
            if reply.get('id') != n: continue
            if 'error' in reply: raise RuntimeError('inspector: ' + json.dumps(reply['error']))
            result = reply['result']
            if result.get('wasThrown'): raise RuntimeError('threw: ' + json.dumps(result['result']))
            return result['result']

    def evaluate(expression):
        nonlocal deadline
        deadline = time.time() + timeout
        wrapped = '(async () => { try { return JSON.stringify({ ok: await (%s) }) } catch (e) { return JSON.stringify({ error: String(e && e.message || e) }) } })()' % expression
        # WebKit's evaluate hands back the promise; awaiting it is a second call.
        promise = call('Runtime.evaluate', {'expression': wrapped, 'emulateUserGesture': True})
        value = call('Runtime.awaitPromise', {'promiseObjectId': promise['objectId'], 'returnByValue': True})
        out = json.loads(value['value'])
        if 'error' in out: raise RuntimeError('threw: ' + out['error'])
        return out.get('ok')

    if expressions == ['-']:
        for line in sys.stdin:
            if not line.strip(): continue
            try:
                answer = {'ok': evaluate(line.strip())}
            except RuntimeError as e:
                answer = {'error': str(e)}
            print(json.dumps(answer, ensure_ascii=False), flush=True)
    else:
        for expression in expressions:
            try:
                print(json.dumps(evaluate(expression), indent=1, ensure_ascii=False))
            except RuntimeError as e:
                raise SystemExit(str(e))
    sock.close()

main()
