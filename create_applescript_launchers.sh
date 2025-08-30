#!/bin/bash

# Create AppleScript launcher apps that won't show in Dock
create_launcher() {
    local name="$1"
    local url="$2"
    local app_path="$HOME/Applications/${name}.app"
    
    # Create the AppleScript
    cat > /tmp/launcher.applescript <<EOF
on run
    do shell script "/Users/johnhughes/llm-burst/launch_llm_chrome.sh \"${url}\""
end run
EOF
    
    # Compile to .app
    osacompile -o "$app_path" /tmp/launcher.applescript
    
    # Hide from Dock
    /usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$app_path/Contents/Info.plist" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$app_path/Contents/Info.plist"
    
    echo "Created: $app_path"
}

# Create launchers
create_launcher "Launch Claude" "https://claude.ai/new"
create_launcher "Launch ChatGPT" "https://chatgpt.com/?model=gpt-5-pro"
create_launcher "Launch Gemini" "https://gemini.google.com/app"
create_launcher "Launch Grok" "https://grok.com"
create_launcher "Launch LLM Burst" ""  # No URL = just launch Chrome with profile

echo "Done! The apps are in ~/Applications/"
echo "You can now:"
echo "1. Copy Chrome's icon to each app (Get Info → paste icon)"
echo "2. Drag them to your Dock"
echo "3. When clicked, only Chrome will appear in the Dock!"