
# STANDALONE PYTHON REFERENCE SCRIPT (V7 - CALIBRATED)
# pip install opencv-python mediapipe

import cv2
import mediapipe as mp
import time
import math

# Initialize Models
mp_hands = mp.solutions.hands
mp_face_mesh = mp.solutions.face_mesh
hands = mp_hands.Hands(static_image_mode=False, max_num_hands=1, min_detection_confidence=0.7)
face_mesh = mp_face_mesh.FaceMesh(refine_landmarks=True, min_detection_confidence=0.5)
mp_draw = mp.solutions.drawing_utils

# Open Webcam
cap = cv2.VideoCapture(0)

print("--- CHRONOS LOCAL LOGIC: V7 CHEEK-NORMALIZED PROTOCOL ---")
print("Logic Gate: PEACE_SIGN + CALIBRATED_SMILE")

last_capture_time = 0

while cap.isOpened():
    success, image = cap.read()
    if not success: break

    # Logic States
    peace_active = False
    all_smiling = False
    faces_detected = 0
    smiles_detected = 0

    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    
    # Process Hand
    hand_results = hands.process(image_rgb)
    if hand_results.multi_hand_landmarks:
        lm = hand_results.multi_hand_landmarks[0].landmark
        # Index & Middle extended
        if lm[8].y < lm[6].y and lm[12].y < lm[10].y and lm[16].y > lm[14].y:
            peace_active = True
        mp_draw.draw_landmarks(image, hand_results.multi_hand_landmarks[0], mp_hands.HAND_CONNECTIONS)

    # Process Faces
    face_results = face_mesh.process(image_rgb)
    if face_results.multi_face_landmarks:
        faces_detected = len(face_results.multi_face_landmarks)
        for landmarks in face_results.multi_face_landmarks:
            lm = landmarks.landmark
            # V7 STABLE RATIO: Mouth Width / Cheek-to-Cheek Width
            # 61, 291: Mouth corners
            # 234, 454: Outer cheek boundaries
            mouth_w = math.dist([lm[61].x, lm[61].y], [lm[291].x, lm[291].y])
            face_w = math.dist([lm[234].x, lm[234].y], [lm[454].x, lm[454].y])
            
            ratio = mouth_w / face_w
            # Thresholds: 0.41 (Neutral) to 0.56 (Big Smile)
            smile_pct = min(100, max(0, ((ratio - 0.41) / 0.15) * 100))

            # Color Logic (BGR)
            color = (0, 0, 255) # Default Red
            if smile_pct > 85: color = (255, 242, 0) # Cyan/Blue
            elif smile_pct > 35: color = (20, 255, 57) # Green
            
            if smile_pct > 35: smiles_detected += 1

            # Render HUD Bounding Box
            h, w, _ = image.shape
            xs = [l.x * w for l in lm]
            ys = [l.y * h for l in lm]
            x_min, x_max = int(min(xs)), int(max(xs))
            y_min, y_max = int(min(ys)), int(max(ys))
            
            cv2.rectangle(image, (x_min-30, y_min-30), (x_max+30, y_max+30), color, 2)
            cv2.putText(image, f"SMILE_CORE: {int(smile_pct)}%", (x_min-30, y_min-45), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

    all_smiling = faces_detected > 0 and smiles_detected == faces_detected

    # Global System Feedback
    status = "SCANNING_TARGETS..."
    if peace_active and all_smiling:
        status = "PROTOCOLS_VALIDATED: CAPTURING"
        curr = time.time()
        if curr - last_capture_time > 5:
            cv2.imwrite(f"bio_v7_{int(curr)}.png", image)
            print(">>> EVENT: BIOMETRIC_MATCH_SAVED")
            last_capture_time = curr
    elif peace_active: status = "WAITING_FOR_SMILE_INDEX"
    elif all_smiling: status = "WAITING_FOR_GESTURE_KEY"

    # Top Status Bar
    cv2.rectangle(image, (0, 0), (w, 50), (0, 0, 0), -1)
    cv2.putText(image, f"CHRONOS_OS_V7: {status}", (20, 35), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 242, 0), 2)
    
    # Binary Key Indicators
    cv2.circle(image, (30, 80), 10, (255, 242, 0) if peace_active else (30, 30, 30), -1)
    cv2.putText(image, "GEST_AUTH", (50, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
    cv2.circle(image, (30, 110), 10, (20, 255, 57) if all_smiling else (30, 30, 30), -1)
    cv2.putText(image, "BIO_AUTH", (50, 115), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

    cv2.imshow('Chronos V7: Biometric Gate', image)
    if cv2.waitKey(5) & 0xFF == 27: break

cap.release()
cv2.destroyAllWindows()
