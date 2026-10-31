# Deployed validation evidence

Started: 2026-10-31T21:56:15.390Z (Shanghai: 2026-11-01 05:56:15)

Target: https://accessassist-git-365255122806.europe-west1.run.app/system

Version: accessassist-git-00008-f92

Source fingerprint: `94bf2bb3789fbb61c46cfa7086cda161e93a78aecaaf0f4103e90dd340ec286a`

{"tests":30,"passed":18,"failed":11,"errors":0,"skipped":1}



| Test | Outcome | Evidence |
| --- | --- | --- |
| T-01 | pass | Received 200 with 0 issue(s) in the contract format. |
| T-02 | pass | Received 200 with 0 issue(s) in the contract format. |
| T-03 | pass | Received a non-empty type list and max_file_size_mb >= 10. |
| T-04 | pass | Expected 415 UNSUPPORTED_MEDIA_TYPE; received 415 UNSUPPORTED_MEDIA_TYPE. |
| T-05 | pass | Expected a 1.1.1 issue; received one. |
| T-06 | pass | Expected 422 UNPROCESSABLE_FILE; received 422 UNPROCESSABLE_FILE. |
| T-07 | pass | Expected 422 UNPROCESSABLE_FILE; received 422 UNPROCESSABLE_FILE. |
| T-08 | pass | Expected 400 MISSING_FILE; received 400 MISSING_FILE. |
| T-09 | pass | Expected 400 INVALID_WCAG_LEVEL; received 400 INVALID_WCAG_LEVEL. |
| T-10 | pass | Expected 413 FILE_TOO_LARGE; received 413 FILE_TOO_LARGE. |
| T-11 | pass | Accepted in 1654 ms. |
| T-12 | pass | Received 200 {"status":"ok"}. |
| T-13 | pass | Plain HTTP redirected to HTTPS (302). |
| T-14 | pass | All three error responses share the { code, message } shape with no issues array. |
| T-15 | pass | Received an empty issues array with an explicit no-violations message. |
| T-16 | skip | Requires local fault injection. |
| T-17 | pass | Received 200 with 0 issue(s) in the contract format. |
| T-18 | fail | Expected 1.4.3; received . |
| T-19 | pass | AA-only contrast is excluded at level A. |
| T-20 | fail | Missing 1.1.1 finding with page 1. |
| T-21 | fail | Expected 1.1.1; received . |
| T-22 | fail | Expected a checked, clean result; received {"wcag_level":"AA","issues":[],"checks_run":[],"no_violations_detected":false,"message":"This file type was accepted, but automated accessibility checks for it are not available yet. No evaluation was performed, so this is not a compliance result."}. |
| T-23 | fail | Expected a checked, clean result; received {"wcag_level":"AA","issues":[],"checks_run":[],"no_violations_detected":false,"message":"This file type was accepted, but automated accessibility checks for it are not available yet. No evaluation was performed, so this is not a compliance result."}. |
| T-24 | fail | Expected HTTP 422; received 200. |
| T-25 | fail | Expected HTTP 422; received 200. |
| T-26 | pass | Detected expected WCAG 3.1.1 with structured findings. |
| T-27 | fail | Expected 1.1.1; received . |
| T-28 | fail | Expected 1.3.1, 4.1.2; received . |
| T-29 | fail | Expected 1.3.1, 3.1.1, 2.4.2; received . |
| T-30 | fail | Missing a location or substantive repair instruction. |
