#!/usr/bin/env swift

import Cocoa
import Foundation

// Minimal Swift app that launches Chrome and immediately terminates
class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        let arguments = CommandLine.arguments
        let url = arguments.count > 1 ? arguments[1] : ""
        
        let scriptPath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Development/tools/llm-burst/launch_llm_chrome.sh")
            .path
        
        var launchArgs = [scriptPath]
        if !url.isEmpty {
            launchArgs.append(url)
        }
        
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/zsh")
        task.arguments = launchArgs
        
        do {
            try task.run()
            // Exit immediately so only Chrome shows in dock
            NSApplication.shared.terminate(nil)
        } catch {
            print("Failed to launch: \(error)")
            NSApplication.shared.terminate(nil)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()