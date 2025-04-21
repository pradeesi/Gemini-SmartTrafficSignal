# app.py
import os
import io
import base64
import json
import logging
import threading
import time # <--- Add time import
import cv2 # OpenCV for camera
import numpy as np # For placeholder image
from flask import Flask, render_template, request, jsonify, Response
from dotenv import load_dotenv
from PIL import Image # For image manipulation (cropping, format conversion)
import atexit # For cleanup on exit
import google.api_core.exceptions # <--- Import for specific exception handling

start_time = time.monotonic() # <--- Define start time early
print(f"[{time.monotonic() - start_time:.3f}s] Starting imports...")

# --- Conditionally import AI Libraries ---
# Determine AI backend from environment variable
AI_BACKEND_MODE = os.getenv("AI_BACKEND", "STUDIO").upper() # Default to STUDIO

# Keep track if imports succeed
vertex_imported = False
genai_imported = False

if AI_BACKEND_MODE == "VERTEX":
    try:
        import vertexai
        from vertexai.generative_models import GenerativeModel, Part
        vertex_imported = True
        print(f"[{time.monotonic() - start_time:.3f}s] Vertex AI libraries imported.")
        logging.info("Attempting to use Vertex AI Backend.")
    except ImportError:
        logging.error("Vertex AI library (google-cloud-aiplatform) not installed. Set AI_BACKEND to STUDIO or install the library.")
        # AI_BACKEND_MODE = "NONE" # Set later based on final success
elif AI_BACKEND_MODE == "STUDIO":
    try:
        import google.generativeai as genai
        genai_imported = True
        print(f"[{time.monotonic() - start_time:.3f}s] AI Studio libraries imported.")
        logging.info("Attempting to use AI Studio Backend.")
    except ImportError:
        logging.error("AI Studio library (google-generativeai) not installed. Set AI_BACKEND to VERTEX or install the library.")
        # AI_BACKEND_MODE = "NONE" # Set later based on final success
# else: # Handled later after checking import success
#     logging.warning(f"Invalid AI_BACKEND value '{AI_BACKEND_MODE}'. Defaulting to no AI.")
#     AI_BACKEND_MODE = "NONE"

print(f"[{time.monotonic() - start_time:.3f}s] Core imports finished.")

# --- Configuration & Setup ---
print(f"[{time.monotonic() - start_time:.3f}s] Loading .env...")
load_dotenv()
print(f"[{time.monotonic() - start_time:.3f}s] .env loaded.")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
app = Flask(__name__)
app.secret_key = os.urandom(24)
print(f"[{time.monotonic() - start_time:.3f}s] Flask app initialized.")


# --- AI Model Initialization ---
print(f"[{time.monotonic() - start_time:.3f}s] Initializing AI Backend ({AI_BACKEND_MODE})...")
gemini_model = None
model_name_info = "N/A"
effective_ai_backend_mode = "NONE" # Start assuming failure

if AI_BACKEND_MODE == "STUDIO" and genai_imported:
    API_KEY = os.getenv("GOOGLE_API_KEY")
    if not API_KEY:
        logging.error("GOOGLE_API_KEY is not set for AI Studio mode.")
    else:
        try:
            print(f"[{time.monotonic() - start_time:.3f}s] Configuring genai...")
            genai.configure(api_key=API_KEY)
            print(f"[{time.monotonic() - start_time:.3f}s] Instantiating AI Studio model...")
            # Use a known stable model name for AI Studio
            gemini_model = genai.GenerativeModel('gemini-1.5-flash-latest')
            model_name_info = f"AI Studio: {gemini_model.model_name}"
            effective_ai_backend_mode = "STUDIO" # Success!
            logging.info(f"Google AI Studio API configured: {model_name_info}")
            print(f"[{time.monotonic() - start_time:.3f}s] AI Studio configured and model instantiated.")
        except Exception as e:
            logging.error(f"Error configuring Google AI Studio API: {e}", exc_info=True)
            print(f"[{time.monotonic() - start_time:.3f}s] AI Studio configuration FAILED.")

elif AI_BACKEND_MODE == "VERTEX" and vertex_imported:
    try:
        PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT")
        LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")

        if not PROJECT_ID:
            raise ValueError("GOOGLE_CLOUD_PROJECT environment variable is not set for Vertex AI mode.")

        print(f"[{time.monotonic() - start_time:.3f}s] Initializing vertexai (Project: {PROJECT_ID}, Location: {LOCATION})...")
        vertexai.init(project=PROJECT_ID, location=LOCATION)
        print(f"[{time.monotonic() - start_time:.3f}s] vertexai.init() successful. Instantiating Vertex AI model...")
        # Use a known stable model name for Vertex AI
        # Check Vertex AI documentation for current recommended models
        gemini_model = GenerativeModel("gemini-1.5-flash-001")
        model_name_info = f"Vertex AI: {gemini_model._model_name} (Project: {PROJECT_ID}, Location: {LOCATION})" # Use _model_name for Vertex
        effective_ai_backend_mode = "VERTEX" # Success!
        logging.info(f"Vertex AI configured: {model_name_info}")
        print(f"[{time.monotonic() - start_time:.3f}s] Vertex AI configured and model instantiated.")

    except Exception as e:
        logging.error(f"Error configuring Vertex AI: {e}", exc_info=True)
        print(f"[{time.monotonic() - start_time:.3f}s] Vertex AI configuration FAILED.")

# Update the global mode based on success/failure
AI_BACKEND_MODE = effective_ai_backend_mode
if AI_BACKEND_MODE == "NONE":
    # This message logs regardless of the reason (invalid setting, missing lib, init failure)
    logging.warning("AI Backend could not be initialized. Analysis endpoint will be disabled.")
print(f"[{time.monotonic() - start_time:.3f}s] AI Model initialization finished. Effective Mode: {AI_BACKEND_MODE}")

# --- Backend Camera State Management ---
output_frame = None
output_frame_lock = threading.Lock()
placeholder_frame = None
camera_thread = None
camera_device = None
is_camera_running = False
camera_start_lock = threading.Lock()

# --- Placeholder Frame Creation ---
print(f"[{time.monotonic() - start_time:.3f}s] Creating placeholder frame...")
def create_placeholder_frame():
    global placeholder_frame
    try:
        width, height = 640, 480; frame = np.zeros((height, width, 3), dtype=np.uint8)
        text = "Camera Stopped"; font = cv2.FONT_HERSHEY_SIMPLEX; font_scale = 0.9; thickness = 2
        text_size = cv2.getTextSize(text, font, font_scale, thickness)[0]
        text_x = (width - text_size[0]) // 2; text_y = (height + text_size[1]) // 2
        cv2.putText(frame, text, (text_x, text_y), font, font_scale, (255, 255, 255), thickness)
        (flag, encoded_image) = cv2.imencode(".jpg", frame)
        if flag: placeholder_frame = encoded_image.tobytes(); logging.info("Placeholder frame created.")
        else: logging.error("Could not encode placeholder!"); placeholder_frame = b''
    except Exception as e: logging.error(f"Error creating placeholder: {e}"); placeholder_frame = b''
create_placeholder_frame()
print(f"[{time.monotonic() - start_time:.3f}s] Placeholder frame created.")


# --- Camera Capture Thread ---
def capture_frames_loop():
    global output_frame, is_camera_running, camera_device
    logging.info("Camera capture thread starting.")
    frame_count = 0; start_time_capture = time.time()
    while is_camera_running:
        if not camera_device or not camera_device.isOpened(): logging.warning("Capture: Camera lost."); is_camera_running = False; break
        try:
            ret, frame = camera_device.read()
            if not ret: logging.warning("Capture: Frame read fail."); is_camera_running = False; break
            with output_frame_lock: output_frame = frame.copy()
            frame_count += 1
        except Exception as e: logging.error(f"Capture error: {e}"); is_camera_running = False; break
        time.sleep(0.01) # Small delay
    duration = time.time() - start_time_capture; fps = frame_count / duration if duration > 0 else 0
    logging.info(f"Capture thread finished. {frame_count} frames (~{fps:.1f} FPS).")
    with output_frame_lock: output_frame = None


# --- Camera Start/Stop Logic ---
def start_camera_process():
    """ Opens camera, attempts resolution, starts thread. Requires camera_start_lock. """
    global is_camera_running, camera_device, camera_thread, output_frame, app_settings
    if is_camera_running: logging.warning("start_camera: already running."); return True
    logging.info("Attempting start camera device...")
    camera_device = None
    # Try common indices first, then higher ones if needed
    for index in range(2): # Try indices 0, 1
        try:
             # Add API preference if needed, e.g., cv2.CAP_ANY, cv2.CAP_DSHOW etc.
             temp_cap = cv2.VideoCapture(index)
             if temp_cap and temp_cap.isOpened():
                 logging.info(f"Camera opened successfully at index {index}.")
                 camera_device = temp_cap
                 break
             else:
                 logging.warning(f"Failed to open camera at index {index}.")
                 if temp_cap: temp_cap.release()
        except Exception as e:
             logging.error(f"Error probing camera index {index}: {e}")

    if camera_device is None:
        logging.error("Cannot open any camera device.")
        return False

    target_resolution=app_settings.get('resolution','default'); target_width,target_height=0,0
    if target_resolution!='default' and 'x' in target_resolution:
        try: parts=target_resolution.split('x'); target_width=int(parts[0]); target_height=int(parts[1])
        except ValueError: logging.warning(f"Invalid resolution format: {target_resolution}. Using default."); target_width,target_height = 0,0
        except Exception as e: logging.warning(f"Error parsing resolution: {e}. Using default."); target_width,target_height = 0,0

    if target_width > 0 and target_height > 0:
        try:
            logging.info(f"Attempting to set resolution: {target_width}x{target_height}...");
            # Attempt to set resolution
            res_set_w = camera_device.set(cv2.CAP_PROP_FRAME_WIDTH, target_width)
            res_set_h = camera_device.set(cv2.CAP_PROP_FRAME_HEIGHT, target_height)
            if not res_set_w or not res_set_h:
                logging.warning("Setting resolution properties returned false. Camera might not support it.")
            # Give camera time to potentially adjust
            time.sleep(0.5)
            # Verify actual resolution
            actual_width=int(camera_device.get(cv2.CAP_PROP_FRAME_WIDTH))
            actual_height=int(camera_device.get(cv2.CAP_PROP_FRAME_HEIGHT))
            logging.info(f"Actual resolution after attempting set: {actual_width}x{actual_height}")
            if actual_width != target_width or actual_height != target_height:
                 logging.warning(f"Camera did not accept target resolution. Using {actual_width}x{actual_height}.")
        except Exception as e:
            logging.error(f"Error setting resolution: {e}")
    else:
        logging.info(f"Using camera's default resolution: {int(camera_device.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(camera_device.get(cv2.CAP_PROP_FRAME_HEIGHT))}")

    is_camera_running = True
    with output_frame_lock:
        output_frame = None # Clear any stale frame
    camera_thread = threading.Thread(target=capture_frames_loop, name="CameraCaptureThread");
    camera_thread.daemon = True; # Allows app to exit even if thread is running
    camera_thread.start()
    logging.info("Camera process started (capture thread running).")
    return True

def stop_camera_process():
    """ Signals thread, waits, releases device. Requires camera_start_lock. """
    global is_camera_running, camera_device, camera_thread, output_frame
    if not is_camera_running and camera_device is None and (camera_thread is None or not camera_thread.is_alive()):
        logging.info("stop_camera_process: Camera already stopped or not running.")
        return # Nothing to do

    logging.info("--- Executing stop_camera_process ---")
    # Signal the thread to stop
    is_camera_running = False

    thread_to_join = camera_thread
    if thread_to_join is not None and thread_to_join.is_alive():
        logging.info("Waiting for camera capture thread to join...")
        thread_to_join.join(timeout=2.0) # Wait for up to 2 seconds
        if thread_to_join.is_alive():
            logging.warning("Camera capture thread did not join within timeout.")
        else:
            logging.info("Camera capture thread joined successfully.")
        camera_thread = None
    elif thread_to_join is not None:
         logging.info("Camera capture thread was already finished.")
         camera_thread = None
    else:
         logging.info("No camera capture thread object existed.")

    # Release the camera device
    device_to_release = camera_device
    if device_to_release is not None:
        if device_to_release.isOpened():
            try:
                logging.info("Releasing camera device...")
                device_to_release.release()
                logging.info("Camera device released.")
            except Exception as e:
                logging.error(f"Exception occurred while releasing camera device: {e}", exc_info=True)
        else:
            logging.info("Camera device object existed but was already closed.")
        camera_device = None
    else:
        logging.info("No camera device object existed to release.")

    # Clear the output frame
    with output_frame_lock:
        output_frame = None
    logging.info("--- Finished stop_camera_process ---")


# --- MJPEG Stream Generators ---
def generate_mjpeg_stream_full():
    """ Generator function yielding FULL MJPEG stream frames or placeholder. """
    global output_frame, is_camera_running, placeholder_frame
    last_yield = 0; target_delay = 1.0 / 20 # Target ~20 FPS stream
    while True:
        now = time.time(); delay = target_delay - (now - last_yield)
        if delay > 0: time.sleep(delay)
        last_yield = time.time()
        frame_bytes = None; content_type = 'image/jpeg'
        if is_camera_running:
            frame = None # Initialize frame variable for this iteration
            with output_frame_lock: # 'with' starts on a new line
                 if output_frame is not None:
                    frame = output_frame.copy() # Work on a copy
                 else:
                     frame = None
            if frame is not None:
                flag, enc = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80]) # Stream quality
                if flag: frame_bytes = enc.tobytes()
                else: logging.warning("MJPEG Full: Encode fail.")
        if frame_bytes is None:
            frame_bytes = placeholder_frame if placeholder_frame else b''
            # Use GIF for empty bytes to avoid browser issues, else JPEG
            content_type = 'image/gif' if not placeholder_frame else 'image/jpeg'
        try:
            yield (b'--frame\r\nContent-Type: '+content_type.encode()+b'\r\nContent-Length: '+f"{len(frame_bytes)}".encode()+b'\r\n\r\n'+frame_bytes+b'\r\n')
        except GeneratorExit:
            logging.debug("MJPEG Full stream generator closed by client.")
            break # Exit loop cleanly if client disconnects
        except Exception as e:
            logging.warning(f"MJPEG Full yield error: {e}");
            break # Exit on other errors

def generate_mjpeg_stream_cropped():
    """ Generator function yielding CROPPED MJPEG stream frames or placeholder. """
    global output_frame, is_camera_running, placeholder_frame, app_settings
    last_yield = 0; target_delay = 1.0 / 20
    while True:
        now = time.time(); delay = target_delay - (now - last_yield)
        if delay > 0: time.sleep(delay)
        last_yield = time.time()
        frame_bytes = None; content_type = 'image/jpeg'
        if is_camera_running:
            full_frame = None # Initialize variable for this iteration
            with output_frame_lock: # 'with' starts on a new line
                if output_frame is not None:
                     full_frame = output_frame.copy() # Work on a copy
                else:
                     full_frame = None
            if full_frame is not None:
                frame_to_encode = full_frame
                try: # Apply crop using OpenCV Slicing
                    crop = app_settings.get("cropArea", {}); img_h, img_w = full_frame.shape[:2]
                    if img_h > 0 and img_w > 0: # Ensure valid dimensions before cropping
                        # Use get with defaults and ensure float conversion
                        cx = float(crop.get("x", 0.0)); cy = float(crop.get("y", 0.0));
                        cw = float(crop.get("w", 1.0)); ch = float(crop.get("h", 1.0));
                        # Validate crop values (allow slight float tolerance)
                        valid = (0.0 <= cx <= 1.0 and 0.0 <= cy <= 1.0 and
                                 0.0 < cw <= 1.0 and 0.0 < ch <= 1.0 and
                                 (cx + cw) <= 1.001 and (cy + ch) <= 1.001)
                        # Check if it's effectively the full image
                        not_full = not (abs(cw - 1.0) < 1e-6 and abs(ch - 1.0) < 1e-6 and
                                        abs(cx - 0.0) < 1e-6 and abs(cy - 0.0) < 1e-6)

                        if valid and not_full:
                            # Calculate pixel coordinates safely
                            y1 = int(cy * img_h); y2 = min(int((cy + ch) * img_h), img_h)
                            x1 = int(cx * img_w); x2 = min(int((cx + cw) * img_w), img_w)
                            # Ensure calculated area is valid
                            if y2 > y1 and x2 > x1:
                                logging.debug(f"MJPEG Crop applied: y={y1}:{y2}, x={x1}:{x2}")
                                frame_to_encode = full_frame[y1:y2, x1:x2]
                            else:
                                logging.warning(f"MJPEG Crop: Calculated zero area ({y1}:{y2}, {x1}:{x2}). Using full frame.")
                        elif not valid:
                             logging.warning(f"MJPEG Crop: Invalid crop values {crop}. Using full frame.")
                    else:
                         logging.warning("MJPEG Crop: Invalid frame dimensions received. Cannot crop.")

                except Exception as e:
                     logging.error(f"MJPEG Crop error processing frame: {e}", exc_info=True)
                     frame_to_encode = full_frame # Fallback to full frame on error

                # Encode the potentially cropped frame
                flag, enc = cv2.imencode(".jpg", frame_to_encode, [cv2.IMWRITE_JPEG_QUALITY, 80])
                if flag: frame_bytes = enc.tobytes()
                else: logging.warning("MJPEG Crop: Encode fail.")
        if frame_bytes is None:
            frame_bytes = placeholder_frame if placeholder_frame else b''
            content_type = 'image/gif' if not placeholder_frame else 'image/jpeg'
        try:
             yield (b'--frame\r\nContent-Type: '+content_type.encode()+b'\r\nContent-Length: '+f"{len(frame_bytes)}".encode()+b'\r\n\r\n'+frame_bytes+b'\r\n')
        except GeneratorExit:
            logging.debug("MJPEG Cropped stream generator closed by client.")
            break # Exit loop cleanly if client disconnects
        except Exception as e:
             logging.warning(f"MJPEG Crop yield error: {e}");
             break # Exit on other errors


# --- Application Settings ---
# *** START: Added new setting with default ***
app_settings = {
    "mode": "Image",
    "apiCallsPerMinute": 6, # MODIFIED Default rate limit
    "resolution": "default",
    "cropArea": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
    "greenLightDurationMs": 3000,
    "yellowLightDurationMs": 1000,
    "maxTimeSmartA_Ms": 10000 # New setting: Default 10 seconds (10000ms)
}
# *** END: Added new setting with default ***

# --- Gemini Analysis Prompt ---
GEMINI_PROMPT = """Analyze the provided image, which shows a view of a road intersection, potentially containing vehicles like cars, bikes (bicycles or motorcycles), trucks, and buses. Your goal is to identify the presence and count of each vehicle type within the specified crop area ONLY.

Respond ONLY with a JSON object adhering strictly to the following format:
{
  "Vehicles_Present": "True" or "False" (string, based on whether ANY vehicles are visible within the crop),
  "Cars": count (integer, number of cars visible),
  "Bikes": count (integer, number of bikes/motorcycles visible),
  "Trucks": count (integer, number of trucks visible),
  "Buses": count (integer, number of buses visible),
  "Unknown": count (integer, number of objects that might be vehicles but cannot be confidently classified into the above categories)
}

IMPORTANT RULES:
- Output ONLY the JSON object. No introductory text, explanations, markdown formatting (like ```json), or concluding remarks.
- If no vehicles of any type are visible within the relevant area, "Vehicles_Present" MUST be "False" and all counts MUST be 0.
- Only count vehicles clearly visible within the image bounds or specified crop area. Do not infer vehicles outside the frame.
- If the image quality is too poor or the view is obstructed, making analysis impossible, respond with "Vehicles_Present": "False" and all counts as 0."""


# --- Helper Functions ---
def validate_settings(new_settings):
    """ Validates incoming settings dictionary from the frontend """
    try:
        # *** START: Added new required key ***
        required_keys = [
            "mode",
            "apiCallsPerMinute", # ADDED
            "resolution",
            "cropArea",
            "greenLightDurationSec",
            "yellowLightDurationSec",
            "maxTimeSmartA_Sec" # Added new key
        ]
        # *** END: Added new required key ***
        assert all(key in new_settings for key in required_keys), f"Missing keys. Required: {required_keys}"

        assert new_settings.get("mode") in ["Image", "Video"], "Invalid 'mode'."

        rate_limit = int(new_settings.get("apiCallsPerMinute", 0))
        assert 1 <= rate_limit <= 60, "'API Calls per Minute' must be between 1 and 60."

        res = new_settings.get("resolution", ""); assert res == "default" or (isinstance(res, str) and 'x' in res and res.split('x')[0].isdigit() and res.split('x')[1].isdigit()), "Invalid 'resolution'."

        crop = new_settings.get("cropArea"); assert isinstance(crop, dict), "'cropArea' must be an object."
        crop_keys = ["x", "y", "w", "h"]; assert all(key in crop for key in crop_keys), f"Missing keys in 'cropArea'. Required: {crop_keys}"
        cx=float(crop['x']); cy=float(crop['y']); cw=float(crop['w']); ch=float(crop['h'])
        assert 0.0<=cx<=1.0 and 0.0<=cy<=1.0 and 0.0<cw<=1.0 and 0.0<ch<=1.0 and (cx+cw)<=1.001 and (cy+ch)<=1.001, "Invalid crop range (0-1 for x/y, >0-1 for w/h, must stay within bounds)."

        green_sec = float(new_settings.get("greenLightDurationSec", 0))
        yellow_sec = float(new_settings.get("yellowLightDurationSec", 0))
        assert green_sec >= 1, "Green light duration must be at least 1 second."
        assert yellow_sec >= 1, "Yellow light duration must be at least 1 second."

        # *** START: Validate new field ***
        max_a_sec = float(new_settings.get("maxTimeSmartA_Sec", 0))
        assert 5 <= max_a_sec <= 300, "'Max Time for Smart A' must be between 5 and 300 seconds."
        # *** END: Validate new field ***

        return True, "" # Valid
    except (AssertionError, ValueError, TypeError, KeyError) as e:
        logging.warning(f"Settings validation failed: {e}")
        return False, str(e)
    except Exception as e:
        logging.error(f"Unexpected error during settings validation: {e}", exc_info=True)
        return False, "Unexpected validation error."

# *** MODIFICATION START: Enhanced Markdown Stripping ***
def parse_gemini_response(response_text):
    """
    Parses the text response from Gemini, attempting to extract a JSON object.
    Handles potential Markdown code fences and validates the structure.
    """
    try:
        # Start by stripping leading/trailing whitespace
        text = response_text.strip()

        # Remove potential markdown fences (```json ... ``` or ``` ... ```)
        # More robust handling than just prefix/suffix check
        if text.startswith("```") and text.endswith("```"):
            # Remove the fences first
            text = text[3:-3].strip()
            # If it started with ```json, remove 'json' part
            if text.startswith("json"):
                 text = text[len("json"):].strip()

        # As a final check, if it doesn't look like JSON object, try finding the core {} block
        # This handles cases where markdown fences might be missing or malformed,
        # but relies on the primary content being a single JSON object.
        if not text.startswith("{") or not text.endswith("}"):
            first_brace_index = text.find('{')
            last_brace_index = text.rfind('}')

            if first_brace_index != -1 and last_brace_index != -1 and last_brace_index > first_brace_index:
                 # Extract the content between the first '{' and the last '}'
                 logging.warning("Response text did not strictly start/end with '{}' after fence stripping. Extracting content between first '{' and last '}'. Original text segment: %s", text[:100])
                 text = text[first_brace_index : last_brace_index + 1].strip()
            else:
                # If we can't find a plausible JSON object structure
                 raise ValueError("Response does not contain a recognizable JSON object structure after cleaning.")


        if not text: raise ValueError("Cleaned response text is empty after processing.")

        # Parse the cleaned text
        logging.debug(f"Attempting to parse cleaned text as JSON: {text[:100]}...")
        data = json.loads(text)
        if not isinstance(data, dict): raise TypeError("Parsed response is not a JSON object.")

        # --- Validate JSON Structure and Content ---
        expected_keys = {"Vehicles_Present", "Cars", "Bikes", "Trucks", "Buses", "Unknown"}
        if not expected_keys.issubset(data.keys()):
            raise ValueError(f"Missing keys. Expected: {expected_keys}, Found: {list(data.keys())}")

        # Validate 'Vehicles_Present' (Case-insensitive check, store as string "True"/"False")
        vp_value = data.get("Vehicles_Present")
        if not isinstance(vp_value, str) or vp_value.upper() not in ["TRUE", "FALSE"]:
             raise ValueError(f"Invalid 'Vehicles_Present' value '{vp_value}' (must be string 'True' or 'False').")
        data["Vehicles_Present"] = str(vp_value.upper() == "TRUE") # Standardize to "True" / "False"

        # Validate counts (must be non-negative integers)
        for key in ["Cars", "Bikes", "Trucks", "Buses", "Unknown"]:
            value = data.get(key)
            if not isinstance(value, int):
                try: data[key] = int(value) # Attempt conversion if not int
                except (ValueError, TypeError): raise ValueError(f"Invalid non-integer value for '{key}'.")
            if data[key] < 0: raise ValueError(f"Value for '{key}' cannot be negative.")

        return data, None # Return parsed data and no error

    except json.JSONDecodeError as e:
        logging.error(f"Gemini response JSON parse error: {e}\nAttempted to parse: {text[:200]}...\nOriginal response: {response_text[:200]}...")
        return None, f"AI response is not valid JSON: {e}"
    except (ValueError, TypeError) as e:
         logging.error(f"Gemini response validation error: {e}\nAttempted to parse: {text[:200]}...\nOriginal response: {response_text[:200]}...")
         return None, f"AI response format error: {e}"
    except Exception as e:
        logging.error(f"Unexpected Gemini parse error: {e}\nOriginal Response: {response_text[:200]}...", exc_info=True)
        return None, f"Unexpected error parsing AI response: {e}"
# *** MODIFICATION END ***


# --- Flask Routes ---
@app.route('/')
def index(): return render_template('index.html', title="Live Analysis")

@app.route('/settings')
def settings_page(): return render_template('settings.html', title="Settings", is_camera_running=is_camera_running)

@app.route('/api/settings', methods=['GET', 'POST'])
def handle_settings():
    global app_settings
    if request.method == 'GET':
        try:
            settings_with_status = {
                **app_settings,
                "isCameraRunning": is_camera_running,
                "aiBackendMode": AI_BACKEND_MODE,
                "aiModelName": model_name_info
            }
            settings_with_status.pop('frameRate', None) # Ensure old frameRate is not sent
            return jsonify(settings_with_status)
        except Exception as e:
             logging.error(f"Error GET /api/settings: {e}", exc_info=True)
             return jsonify({"error": "Failed retrieve settings."}), 500
    elif request.method == 'POST':
        try:
            new_settings = request.get_json()
            if not new_settings: return jsonify({"error": "No JSON data received."}), 400

            is_valid, error_msg = validate_settings(new_settings)
            if not is_valid:
                logging.warning(f"Invalid settings received: {error_msg}. Data: {new_settings}")
                return jsonify({"error": f"Invalid settings data: {error_msg}"}), 400

            # Update settings, converting seconds to milliseconds where needed
            app_settings["mode"] = new_settings["mode"]
            app_settings["apiCallsPerMinute"] = int(new_settings["apiCallsPerMinute"])
            app_settings["resolution"] = new_settings["resolution"]
            app_settings["cropArea"] = {k: float(v) for k, v in new_settings["cropArea"].items()}
            app_settings["greenLightDurationMs"] = int(float(new_settings["greenLightDurationSec"]) * 1000)
            app_settings["yellowLightDurationMs"] = int(float(new_settings["yellowLightDurationSec"]) * 1000)
            # *** START: Store new setting in ms ***
            app_settings["maxTimeSmartA_Ms"] = int(float(new_settings["maxTimeSmartA_Sec"]) * 1000)
            # *** END: Store new setting in ms ***


            logging.info(f"Settings updated via API: {app_settings}")
            return jsonify({"message": "Settings updated successfully."}), 200
        except (AssertionError, ValueError, TypeError) as e:
            logging.warning(f"Invalid settings received: {e}. Data: {request.data[:200]}")
            return jsonify({"error": f"Invalid settings data: {e}"}), 400
        except Exception as e:
            logging.exception("Error POST /api/settings:")
            return jsonify({"error": "Internal server error updating settings."}), 500

# --- Other Routes ---
@app.route('/video_feed')
def video_feed():
    logging.debug("Client connection request: CROPPED video stream.")
    try:
        headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, pre-check=0, post-check=0, max-age=0', 'Pragma': 'no-cache', 'Expires': '-1' }
        return Response(generate_mjpeg_stream_cropped(), mimetype='multipart/x-mixed-replace; boundary=frame', headers=headers)
    except Exception as e:
         logging.error(f"Error creating /video_feed (cropped) response: {e}", exc_info=True)
         return "Error generating cropped video stream.", 500, {'Content-Type': 'text/plain'}

@app.route('/video_feed_full')
def video_feed_full():
    logging.debug("Client connection request: FULL video stream.")
    try:
        headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, pre-check=0, post-check=0, max-age=0', 'Pragma': 'no-cache', 'Expires': '-1' }
        return Response(generate_mjpeg_stream_full(), mimetype='multipart/x-mixed-replace; boundary=frame', headers=headers)
    except Exception as e:
         logging.error(f"Error creating /video_feed_full response: {e}", exc_info=True)
         return "Error generating full video stream.", 500, {'Content-Type': 'text/plain'}

@app.route('/api/camera/start', methods=['POST'])
def api_start_camera():
    try:
        logging.info("Attempting to acquire camera_start_lock for START...")
        with camera_start_lock:
            logging.info("Acquired camera_start_lock for START.")
            success = start_camera_process()
        logging.info("Released camera_start_lock after START.")
        if success:
            return jsonify({"message": "Camera process started successfully."}), 200
        else:
            return jsonify({"error": "Failed to initialize or start camera device."}), 500
    except Exception as e:
         logging.exception("Unexpected error during /api/camera/start:")
         return jsonify({"error": "An unexpected error occurred while starting the camera."}), 500

@app.route('/api/camera/stop', methods=['POST'])
def api_stop_camera():
    try:
        logging.info("Attempting to acquire camera_start_lock for STOP...")
        with camera_start_lock:
            logging.info("Acquired camera_start_lock for STOP.")
            stop_camera_process()
        logging.info("Released camera_start_lock after STOP.")
        return jsonify({"message": "Camera process stopped successfully."}), 200
    except Exception as e:
        logging.exception("Unexpected error during /api/camera/stop:")
        return jsonify({"error": "An unexpected error occurred while stopping the camera."}), 500

@app.route('/api/analyze', methods=['POST'])
def analyze_image():
    global output_frame, is_camera_running, AI_BACKEND_MODE, gemini_model

    if AI_BACKEND_MODE == "NONE" or gemini_model is None:
        logging.warning("Analysis request ignored: AI backend is not configured or failed initialization.")
        return jsonify({"error": "AI backend not available."}), 503
    if not is_camera_running:
        logging.warning("Analysis request ignored: Camera is not running.")
        return jsonify({"error": "Analysis stopped: Camera not running."}), 409 # Use 409 Conflict

    current_frame = None
    with output_frame_lock:
        if output_frame is not None: current_frame = output_frame.copy()
    if current_frame is None:
        logging.warning("Analysis request failed: Frame not available from camera thread.")
        return jsonify({"error": "Frame not available yet. Try again shortly."}), 503

    # --- Frame Processing (Cropping) ---
    try:
        if not isinstance(current_frame, np.ndarray): raise TypeError(f"Frame is not a NumPy array: {type(current_frame)}")
        img_input_pil = Image.fromarray(cv2.cvtColor(current_frame, cv2.COLOR_BGR2RGB))
        logging.debug(f"ANALYSIS: Original frame size (WxH): {img_input_pil.size}")
        img_to_analyze = img_input_pil
        try:
            crop = app_settings.get("cropArea", {}); img_width, img_height = img_input_pil.size
            if img_width > 0 and img_height > 0:
                crop_x = float(crop.get("x", 0.0)); crop_y = float(crop.get("y", 0.0));
                crop_w = float(crop.get("w", 1.0)); crop_h = float(crop.get("h", 1.0));
                is_valid_crop = (0.0 <= crop_x <= 1.0 and 0.0 <= crop_y <= 1.0 and 0.0 < crop_w <= 1.0 and 0.0 < crop_h <= 1.0 and (crop_x + crop_w) <= 1.001 and (crop_y + crop_h) <= 1.001)
                is_full_image = (abs(crop_w - 1.0) < 1e-6 and abs(crop_h - 1.0) < 1e-6 and abs(crop_x - 0.0) < 1e-6 and abs(crop_y - 0.0) < 1e-6)
                if is_valid_crop and not is_full_image:
                    left = int(crop_x * img_width); top = int(crop_y * img_height);
                    right = min(int((crop_x + crop_w) * img_width), img_width); bottom = min(int((crop_y + crop_h) * img_height), img_height);
                    if right > left and bottom > top:
                        logging.info(f"ANALYSIS: Applying crop - Pixels: ({left}, {top}, {right}, {bottom})")
                        img_to_analyze = img_input_pil.crop((left, top, right, bottom))
                        logging.info(f"ANALYSIS: Cropped image size (WxH): {img_to_analyze.size}")
                    else:
                        logging.warning(f"ANALYSIS: Calculated zero-area crop box: ({left}, {top}, {right}, {bottom}). Using full image.")
                        img_to_analyze = img_input_pil
                elif not is_valid_crop:
                     logging.warning(f"ANALYSIS: Invalid crop values in settings: {crop}. Using full image.")
                     img_to_analyze = img_input_pil
            else:
                 logging.warning("ANALYSIS: Invalid original frame dimensions received. Cannot crop.")
                 img_to_analyze = img_input_pil
        except Exception as crop_err:
            logging.error(f"ANALYSIS: Error during cropping: {crop_err}. Using full image.", exc_info=True)
            img_to_analyze = img_input_pil
    except Exception as convert_err:
        logging.error(f"Frame conversion/processing error before AI call: {convert_err}", exc_info=True)
        return jsonify({"error": "Error processing frame before analysis."}), 500

    # --- Payload Preparation ---
    analysis_payload = None
    try:
        if AI_BACKEND_MODE == "STUDIO":
            analysis_payload = [GEMINI_PROMPT, img_to_analyze]
            logging.debug(f"Prepared payload for AI Studio (PIL Image size: {img_to_analyze.size})")
        elif AI_BACKEND_MODE == "VERTEX":
            buffer = io.BytesIO(); img_format = "JPEG"; img_to_analyze.save(buffer, format=img_format); image_bytes = buffer.getvalue()
            if not image_bytes: raise ValueError("Image conversion to bytes resulted in empty data.")
            mime = f"image/{img_format.lower()}"; image_part = Part.from_data(data=image_bytes, mime_type=mime)
            analysis_payload = [GEMINI_PROMPT, image_part]
            logging.debug(f"Prepared payload for Vertex AI ({len(image_bytes)} bytes, {mime})")
        else: raise RuntimeError("AI Backend mode inconsistent state.")
    except Exception as prep_err:
         logging.error(f"Error preparing analysis payload for {AI_BACKEND_MODE}: {prep_err}", exc_info=True)
         return jsonify({"error": f"Internal error preparing image for {AI_BACKEND_MODE}."}), 500

    # --- API Call and Response Handling ---
    try:
        logging.info(f"Sending request to {AI_BACKEND_MODE} backend...")
        analysis_start_time = time.monotonic()
        response = gemini_model.generate_content(analysis_payload)
        duration = time.monotonic() - analysis_start_time
        logging.info(f"{AI_BACKEND_MODE} analysis completed in {duration:.3f} seconds.")

        # *** Use the modified parse_gemini_response function ***
        analysis_result, parse_error = parse_gemini_response(response.text)

        if parse_error:
            # Return the error and include the raw text for frontend logging
            # Use 502 Bad Gateway, as we failed to process a response from the upstream AI server
            return jsonify({"error": parse_error, "raw_response": response.text}), 502
        else:
            # Return successful analysis and include raw text (response.text) for logging
            analysis_result["raw_response"] = response.text # Add raw response to success case
            return jsonify(analysis_result), 200

    except google.api_core.exceptions.ResourceExhausted as e:
        quota_error_message = "Error: You exceeded your current API Quota, please check your plan and billing details."
        logging.error(f"{AI_BACKEND_MODE} API Quota Exceeded: {e}", exc_info=True)
        # Return the specific message and 429 status code
        return jsonify({
            "quota_error": quota_error_message,
            "raw_response": f"Quota Error: {e}" # Include original error details in raw_response
        }), 429 # HTTP 429 Too Many Requests

    except Exception as ai_err:
        # Log first, then prepare the error response
        logging.error(f"{AI_BACKEND_MODE} API call or response processing failed: {ai_err}", exc_info=True)
        # Simply convert the exception to string for the raw response
        raw_text_on_error = f"AI Error: {str(ai_err)}"
        # Return a generic server error (503 Service Unavailable fits AI backend issues)
        return jsonify({"error": f"AI analysis failed using {AI_BACKEND_MODE} backend.", "raw_response": raw_text_on_error}), 503


# --- Cleanup Hook ---
@atexit.register
def cleanup_on_exit():
    logging.info("Application exit detected. Running cleanup...")
    acquired = camera_start_lock.acquire(timeout=1.0)
    if acquired:
        try: stop_camera_process()
        finally: camera_start_lock.release(); logging.info("Cleanup lock released.")
    else: logging.warning("Could not acquire lock during exit cleanup. Camera might not be released cleanly.")
    logging.info("Cleanup finished.")


# --- Run Application ---
if __name__ == '__main__':
    print(f"[{time.monotonic() - start_time:.3f}s] Entering main execution block (__name__ == '__main__').")
    logging.info(f"Starting Flask application...")
    logging.info(f"AI Backend Mode: {AI_BACKEND_MODE}") # Log the effective mode
    if AI_BACKEND_MODE != "NONE":
        logging.info(f"AI Model: {model_name_info}")
    else:
        logging.warning("AI Analysis features will be unavailable.")

    print(f"[{time.monotonic() - start_time:.3f}s] Attempting to start web server...")
    # Use Waitress for a more production-ready server than Flask's default
    try:
        from waitress import serve
        print(f"[{time.monotonic() - start_time:.3f}s] Starting Waitress server on 0.0.0.0:5000...")
        serve(app, host='0.0.0.0', port=5000, threads=10) # Listen on all interfaces
    except ImportError:
        logging.warning("Waitress not installed. Falling back to Flask development server (not recommended for production).")
        print(f"[{time.monotonic() - start_time:.3f}s] Starting Flask development server on 0.0.0.0:5000...")
        app.run(host='0.0.0.0', port=5000, debug=False) # Debug mode False
    except Exception as run_err:
         logging.critical(f"Failed to start the web server: {run_err}", exc_info=True)
         print(f"[{time.monotonic() - start_time:.3f}s] Web server FAILED to start.")