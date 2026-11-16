#!/usr/bin/env python3
"""Evaluates JavaScript in the app's WebView in a booted iOS simulator.

  scripts/ios-webview.py <device> <bundle id> '<expression>' [seconds]

  scripts/ios-webview.py 'iPhone 17' com.thingglance.app 'Capacitor.Plugins.Reminders.pending()'

The expression's value is printed as JSON; a promise is awaited first. It is
the iOS stand-in for what scripts/android-check.mjs does over Chrome's
debugging port (docs/ios.md).

It speaks the Web Inspector's own wire protocol to the simulator's
webinspectord: binary property lists, each behind a four-byte length, on the
unix socket the simulator names in RWI_LISTEN_SOCKET. Nothing to install. Only
a debug build's WebView is inspectable.
"""
import json, plistlib, socket, struct, subprocess, sys, time, uuid

def main():
    if len(sys.argv) < 4: raise SystemExit(__doc__)
    device, bundle, expression = sys.argv[1], sys.argv[2], sys.argv[3]
    timeout = float(sys.argv[4]) if len(sys.argv) > 4 else 20
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

    def recv():
        (n,) = struct.unpack('>I', read_exact(4))
        msg = plistlib.loads(read_exact(n))
        return msg.get('__selector'), msg.get('__argument', {})

    send('_rpc_reportIdentifier:')
    app = page = None
    deadline = time.time() + timeout
    asked = False
    while page is None:
        if time.time() > deadline: raise SystemExit('no inspectable page for ' + bundle)
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

    wrapped = '(async () => { try { return JSON.stringify({ ok: await (%s) }) } catch (e) { return JSON.stringify({ error: String(e && e.message || e) }) } })()' % expression
    def call(n, method, params):
        send_json({'id': 100 + n, 'method': 'Target.sendMessageToTarget', 'params': {'targetId': target, 'message': json.dumps({'id': n, 'method': method, 'params': params})}})
        while True:
            m = recv_json()
            if m.get('method') != 'Target.dispatchMessageFromTarget': continue
            reply = json.loads(m['params']['message'])
            if reply.get('id') != n: continue
            if 'error' in reply: raise SystemExit('inspector: ' + json.dumps(reply['error']))
            result = reply['result']
            if result.get('wasThrown'): raise SystemExit('threw: ' + json.dumps(result['result']))
            return result['result']

    # WebKit's evaluate hands back the promise; awaiting it is a second call.
    promise = call(1, 'Runtime.evaluate', {'expression': wrapped, 'emulateUserGesture': True})
    value = call(2, 'Runtime.awaitPromise', {'promiseObjectId': promise['objectId'], 'returnByValue': True})
    out = json.loads(value['value'])
    if 'error' in out: raise SystemExit('threw: ' + out['error'])
    print(json.dumps(out.get('ok'), indent=1, ensure_ascii=False))

main()
