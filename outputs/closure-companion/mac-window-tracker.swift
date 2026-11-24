import AppKit
import CoreGraphics

private let codexBundle = "com.openai.codex"

func frontCodexBounds() -> CGRect? {
    guard let active = NSWorkspace.shared.frontmostApplication,
          active.bundleIdentifier == codexBundle,
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

var last = ""
repeat {
    let state: [String: Any]
    if let bounds = frontCodexBounds() {
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
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
} while true
