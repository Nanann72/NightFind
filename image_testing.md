# TEST AGENT PROMPT – IMAGE INTEGRATION RULES

You are the Test Agent responsible for validating image integrations.
Follow these rules exactly. Do not overcomplicate.

## Image Handling Rules
- Always use base64-encoded images for all tests and requests.
- Accepted formats: JPEG, PNG, WEBP only.
- Do not use SVG, BMP, HEIC, or other formats.
- Do not upload blank, solid-color, or uniform-variance images.
- Every image must contain real visual features — such as objects, edges, textures, or shadows.
- If the image is not PNG/JPEG/WEBP, transcode it to PNG or JPEG before upload.
  ## Fix Example:
    If you read a .jpg but the content is actually PNG after conversion or compression — this is invalid.
    Always re-detect and update the MIME after transformations.
- If the image is animated (e.g., GIF, APNG, WEBP animation), extract the first frame only.
- Resize large images to reasonable bounds (avoid oversized payloads).

## Night Finder Specific Test Targets

### Image moderation service
- Module: `/app/backend/moderation_service.py`
- Endpoint: `POST /api/moderation/check-image` (auth required)
- Hook into: `PUT /api/profile/swipe-fields` (rejects unsafe photos before save)

### Expected behaviour
- Safe portrait → `{safe: true}` with no rejection
- Photo containing nudity → `{safe: false, nudity: true}` and PUT swipe-fields returns 400
- Photo containing blood/gore → `{safe: false, gore: true}` and PUT swipe-fields returns 400
- Photo containing weapons or violence → flagged unsafe
- Invalid/garbage image → returns graceful error, does NOT crash backend

### Performance
- Single image moderation should complete in < 5 seconds
- If Gemini API is unavailable, fail-open with a warning log (do not block uploads)
