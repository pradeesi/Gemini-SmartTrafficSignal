# create_folders.py
import os

folders = [
    "static/css",
    "static/js",
    "templates"
]

base_dir = os.path.dirname(os.path.abspath(__file__))

for folder in folders:
    try:
        os.makedirs(os.path.join(base_dir, folder), exist_ok=True)
        print(f"Created folder: {folder}")
    except OSError as e:
        print(f"Error creating folder {folder}: {e}")

# Create empty files to indicate structure (optional)
files_to_touch = [
    "app.py",
    "requirements.txt",
    ".env",
    "templates/base.html",
    "templates/index.html",
    "templates/settings.html",
    "static/css/style.css",
    "static/js/main.js",
    "static/js/settings.js",
    "static/js/theme.js"
]

for filename in files_to_touch:
     filepath = os.path.join(base_dir, filename)
     if not os.path.exists(filepath):
        with open(filepath, 'w') as f:
            pass # Create empty file
        print(f"Created file: {filename}")

print("\nProject structure created successfully.")
print("IMPORTANT: Add your Google Gemini API Key to the '.env' file.")