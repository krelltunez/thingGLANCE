// After lastGLANCE's ios/App/ShareExtension/ShareViewController.swift. Keep a fix in step with it.
import GlanceKit
import UIKit
import UniformTypeIdentifiers

// "Share to thingGLANCE": a product page or a name, from any app, becomes a
// thing to add.
//
// A share extension can never open its app. So the share is written down in
// the App Group as an ordinary add link (the page's title wins; failing that,
// the shared text without its links, as on Android) and the form opens with it
// filled in the next time thingGLANCE comes to the front. Nothing is made
// until that form is saved.
@objc(ShareViewController)
final class ShareViewController: UIViewController {

    private let card = UIView()
    private let headline = UILabel()
    private let detail = UILabel()
    private let doneButton = UIButton(type: .system)

    private let accent = UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0x38 / 255, green: 0xBD / 255, blue: 0xF8 / 255, alpha: 1)
        : UIColor(red: 0x02 / 255, green: 0x84 / 255, blue: 0xC7 / 255, alpha: 1) }

    override func viewDidLoad() {
        super.viewDidLoad()
        buildUI()
        Task {
            let outcome = await captureShare()
            show(outcome)
        }
    }

    private enum Outcome {
        case saved(name: String?)
        case nothing
    }

    private func captureShare() async -> Outcome {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        var subject: String?
        var text: String?
        var found = false

        for item in items {
            if subject == nil, let title = item.attributedTitle?.string, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                subject = title
            }
            if text == nil, let content = item.attributedContentText?.string, !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                text = content
                found = true
            }
            for provider in item.attachments ?? [] {
                if await load(provider, as: UTType.url) != nil {
                    found = true
                } else if let plain = await load(provider, as: UTType.plainText) {
                    found = true
                    if text == nil { text = plain }
                }
            }
        }

        guard found || subject != nil else { return .nothing }
        // A bare address names nothing: the form opens empty, as on Android.
        let name = OutsideLinks.sharedName(subject: subject, text: text)
        SharedStore().queueShare(name: name)
        return .saved(name: name)
    }

    private func load(_ provider: NSItemProvider, as type: UTType) async -> String? {
        guard provider.hasItemConformingToTypeIdentifier(type.identifier) else { return nil }
        let item = try? await provider.loadItem(forTypeIdentifier: type.identifier)
        if let url = item as? URL { return url.absoluteString }
        if let s = item as? String, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return s }
        if let data = item as? Data, let s = String(data: data, encoding: .utf8), !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return s }
        return nil
    }

    private func buildUI() {
        view.backgroundColor = UIColor.black.withAlphaComponent(0.4)

        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 16
        card.translatesAutoresizingMaskIntoConstraints = false
        card.alpha = 0
        view.addSubview(card)

        headline.font = .systemFont(ofSize: 17, weight: .semibold)
        headline.textColor = .label
        headline.numberOfLines = 1
        headline.textAlignment = .center

        detail.font = .systemFont(ofSize: 14)
        detail.textColor = .secondaryLabel
        detail.numberOfLines = 5
        detail.textAlignment = .center

        doneButton.setTitle("Done", for: .normal)
        doneButton.setTitleColor(accent, for: .normal)
        doneButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        doneButton.addTarget(self, action: #selector(finish), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [headline, detail, doneButton])
        stack.axis = .vertical
        stack.spacing = 12
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            card.widthAnchor.constraint(lessThanOrEqualToConstant: 340),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
        ])
    }

    private func show(_ outcome: Outcome) {
        switch outcome {
        case .saved(let name):
            headline.text = "Kept for thingGLANCE"
            let lead = name.map { "\($0)\n\n" } ?? ""
            detail.text = lead + "The form to add it opens the next time you open thingGLANCE. Nothing is added until you save it."
        case .nothing:
            headline.text = "Nothing to keep"
            detail.text = "This did not hold any text or link thingGLANCE could use."
        }
        UIView.animate(withDuration: 0.2) { self.card.alpha = 1 }
    }

    @objc private func finish() {
        extensionContext?.completeRequest(returningItems: [])
    }
}
