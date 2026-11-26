import AppKit
import CoreGraphics

private let codexBundle = "com.openai.codex"
private let dshBundle = "com.deepseek.dsh"

func frontHostBounds(_ bundles: Set<String>) -> CGRect? {
    guard let active = NSWorkspace.shared.frontmostApplication,
          let bundle = active.bundleIdentifier, bundles.contains(bundle),
          let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }
    for window in windows {
        guard window[kCGWindowLayer as String] as? Int == 0 else { continue }
        // A different normal window in front of Codex can be a system modal panel.
        guard window[kCGWindowOwnerPID as String] as? pid_t == active.processIdentifier,
              let rawBounds = window[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: rawBounds),
              bounds.width >= 360, bounds.height >= 260 else { return nil }
        return bounds
    }
    return nil
}

let pointerAvoidance = CommandLine.arguments.contains("--pointer-avoidance")
let petInteractionApps: Set<String> = [codexBundle, dshBundle, "com.apple.finder", "local.closure-codex.companion"]
let hostApps = ["codex": codexBundle, "dsh": dshBundle]
let selectedHosts = Set(CommandLine.arguments.dropFirst().compactMap { hostApps[$0] })
let followedHosts: Set<String> = selectedHosts.isEmpty ? [codexBundle] : selectedHosts

var last = ""
repeat {
    let state: [String: Any]
    if pointerAvoidance {
        let active = NSWorkspace.shared.frontmostApplication
        let option = CGEventSource.flagsState(.combinedSessionState).contains(.maskAlternate)
        state = ["avoid": active != nil && !petInteractionApps.contains(active?.bundleIdentifier ?? "") && !option]
    } else if let bounds = frontHostBounds(followedHosts) {
        state = ["visible": true, "x": Int(bounds.minX), "y": Int(bounds.minY),
                 "width": Int(bounds.width), "height": Int(bounds.height)]
    } else {
        state = ["visible": false]
    }
    let data = try JSONSerialization.data(withJSONObject: state, options: .sortedKeys)
    let line = String(decoding: data, as: UTF8.self)
    if line != last {
        print(line)
        fflush(stdout)
        last = line
    }
    if CommandLine.arguments.contains("--once") { break }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: pointerAvoidance ? 0.05 : 0.2))
} while true
