# Gemini-SmartTrafficSignal (Road Watcher)

## Project Overview

This project implements a smart traffic signal system named "Road Watcher". It uses a webcam to monitor traffic at an intersection (specifically focusing on one direction, labeled "Direction A") and leverages the Google Gemini AI model (via AI Studio or Vertex AI) to analyze the video feed for vehicle presence. Based on the analysis or a timer, it simulates traffic light changes for four directions (A, B, C, D). The system provides a web interface to view the live camera feed, analysis results, traffic light simulation, and configure settings.

## Features

* **Live Camera Feed:** Displays the webcam feed in the web UI.
* **AI-Powered Traffic Analysis:** Uses Gemini AI to detect vehicles (Cars, Bikes, Trucks, Buses) in a user-defined region of the camera feed (specifically for controlling Direction A).
* **Simulated Traffic Lights:** Visualizes traffic light states (Red, Yellow, Green) for four directions.
* **Dual Operation Modes:**
    * **Timer Mode:** Runs traffic lights on a fixed cycle based on user-defined durations.
    * **AI Mode (Smart Mode):** Controls Direction A based on AI analysis (skips green if no vehicles, extends green up to a max time if vehicles present) while other directions run on timers.
* **Web-Based Configuration:** Allows users to set:
    * Operation mode (Timer/AI).
    * AI analysis rate (API calls per minute).
    * Camera capture resolution.
    * Analysis area cropping.
    * Green and Yellow light durations.
    * Maximum green light time for Direction A in AI mode.
* **Backend Selection:** Supports using either Google AI Studio or Vertex AI as the Gemini backend, configured via environment variables.
* **Visual Feedback:** Highlights the active traffic direction and provides status updates and API call logs in the UI.

## How it Works

1.  **Backend (app.py):**
    * A Flask web server handles requests.
    * Uses OpenCV to capture frames from a connected webcam.
    * Streams the video feed (full and cropped versions) to the frontend using MJPEG.
    * Manages application settings (loaded initially and updated via the settings UI).
    * In **AI Mode**:
        * Periodically (based on the configured rate limit), sends the current (optionally cropped) camera frame to the configured Gemini AI backend (AI Studio or Vertex AI) along with a specific prompt asking for vehicle counts.
        * Parses the JSON response from Gemini.
        * Uses the vehicle presence data (`Vehicles_Present` field) to influence the traffic light logic for Direction A. Analysis is typically active during Direction D's cycle and Direction A's green phase.
    * In **Timer Mode**:
        * Cycles through the traffic lights (A -> B -> C -> D -> A...) based purely on the configured green and yellow light durations. The camera is stopped, and no AI analysis is performed.
    * Manages the traffic light state machine (`advanceTrafficLights` function), transitioning between states (e.g., A_GREEN, A_YELLOW, ALL_RED_BEFORE_B, B_GREEN...) based on timers and AI results (in AI Mode).
    * Handles camera start/stop operations initiated by the mode toggle.
    * Uses `python-dotenv` to load API keys and configuration from a `.env` file.
    * Includes graceful cleanup (`atexit`) to release the camera on shutdown.
2.  **Frontend (HTML/CSS/JS):**
    * Provides the user interface using Bootstrap and custom CSS (`style.css`).
    * Displays the traffic light simulation, updating lights and timers.
    * Shows the live camera feed (`index.html`, `settings.html`).
    * In AI Mode, displays the parsed analysis results (vehicle counts) and raw Gemini API call logs.
    * Provides a settings page (`settings.html`) where users can:
        * Adjust operational parameters.
        * Visually define the cropping area for analysis by drawing on the live feed.
    * Handles the mode toggle switch, sending requests to the backend to start/stop the camera and switch logic.
    * Includes theme toggling (Light/Dark) functionality (`theme.js`).

## Setup Instructions

1.  **Prerequisites:** Ensure you have Python 3.x and `pip` installed on your laptop.
2.  **Clone/Download:** Get the `Gemini-SmartTrafficSignal` code onto your machine.
3.  **Navigate:** Open a terminal or command prompt and navigate into the `Gemini-SmartTrafficSignal` directory.
4.  **Create Project Structure (Optional but Recommended):**
    * Run the setup script: `python setup.py`
    * This creates necessary folders (`static/css`, `static/js`, `templates`) and empty placeholder files if they don't exist.
5.  **Install Dependencies:**
    * Install the required Python libraries: `pip install -r requirements.txt`[cite: 1].
6.  **Configure Environment Variables:**
    * Create a file named `.env` in the `Gemini-SmartTrafficSignal` directory.
    * Add your API keys and configuration based on the backend you want to use:
        * **For Google AI Studio:**
            ```dotenv
            # .env file
            AI_BACKEND=STUDIO
            GOOGLE_API_KEY=YOUR_GOOGLE_API_KEY_HERE
            ```
        * **For Google Vertex AI:**
            ```dotenv
            # .env file
            AI_BACKEND=VERTEX
            GOOGLE_CLOUD_PROJECT=YOUR_GOOGLE_CLOUD_PROJECT_ID
            GOOGLE_CLOUD_LOCATION=YOUR_VERTEX_AI_REGION # e.g., us-central1
            ```
            *Note: Ensure your environment is authenticated to Google Cloud if using Vertex AI (e.g., via `gcloud auth application-default login`).*
    * Replace the placeholder values (`YOUR_...`) with your actual credentials.

## Running the Application

1.  **Navigate:** Make sure your terminal/command prompt is in the `Gemini-SmartTrafficSignal` directory.
2.  **Run:** Execute the Flask application: `python app.py`.
3.  **Access:** Open a web browser and go to `http://127.0.0.1:5000` or `http://localhost:5000`. If running on a network, you might access it via the machine's IP address (e.g., `http://<your-laptop-ip>:5000`) as the server listens on `0.0.0.0`.
4.  **Interact:**
    * The application starts in **Timer Mode** by default (or AI Mode if the camera was detected as running on startup).
    * Use the toggle switch on the "Live View" page to switch between **Timer Mode** and **AI Mode**. Switching to AI mode will attempt to start the camera.
    * Go to the **Settings** page to configure timings, analysis rate, resolution, and the cropping area. Remember to save settings.

## Configuration

* **Backend Selection:** Set the `AI_BACKEND` variable in the `.env` file to either `STUDIO` or `VERTEX`.
* **API Credentials:** Provide the necessary API key (`GOOGLE_API_KEY`) or Cloud project details (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`) in the `.env` file.
* **Web UI Settings:** Use the "Settings" page in the web application to configure:
    * `Operation Mode`: (Handled by the toggle on the main page primarily).
    * `Max API Calls per Minute`: Controls the AI analysis frequency (1-60). Lower values reduce API costs/usage.
    * `Capture Resolution`: Attempts to set the camera resolution. Lower resolutions can improve performance and reduce data sent for analysis.
    * `Signal Timings`: Set the duration for Green and Yellow lights (in seconds).
    * `Max Time for Smart Direction A`: The maximum time Direction A will stay green in AI Mode, even if vehicles are still detected.
    * `Analysis Area (Cropping)`: Draw a rectangle on the video feed in the settings page to define the specific region Gemini should analyze.

## Dependencies

The core dependencies are listed in `requirements.txt`[cite: 1]:

* Flask: Web framework[cite: 1].
* python-dotenv: For loading `.env` files[cite: 1].
* google-generativeai: Google AI Studio client library[cite: 1].
* google-cloud-aiplatform: Google Vertex AI client library[cite: 1].
* Pillow: Image processing[cite: 1].
* waitress: Production-grade WSGI server[cite: 1].
* opencv-python-headless: Computer vision library for camera access and image processing[cite: 1].
* numpy: Numerical library (often required by OpenCV)[cite: 1].
  
