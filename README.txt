Electronic Chart Work — Baseline Bundle

Files
- index.html
- styles.css
- app.js
- CHANGELOG.txt
- REGRESSION_CHECKLIST.txt

Workflow agreed from this point
1. Treat this bundle as the canonical baseline.
2. Make future changes only against this baseline.
3. Issue a full updated bundle after each accepted change.
4. Save each accepted bundle as a versioned release zip.
5. Run the regression checklist after each change.


File-based save/load
- Save exports the current artefacts as a JSON file.
- Load imports a previously saved JSON file.
- This supports multiple named save versions outside the browser.

Current save/load behaviour
- Save uses an in-app modal to name and download a JSON file.
- Load uses an in-app modal with a visible file picker.

Updated in v4
- Save and Load now use visible side panels under the toolbar instead of overlay modals.

Updated in v5
- Fixed a leftover deleted-button event listener that was preventing later UI handlers from being attached.

Updated in v6
- Added OpenSeaMap seamark overlay above the OpenStreetMap base layer.
- A layer toggle is available on the map.

Updated in v7
- All line tools now use a single press-drag-release gesture.

Updated in v8
- Toolbar reorganised into logical groups with dividers.

Updated in v9
- Fixed CMG/CTS button wiring.
- Moved status box to bottom-left.
- Replaced visible group dividers with spacing.

Updated in v10
- Fixed line selection regression.
- Toolbar is now a single horizontal row so Clear stays aligned with the other controls.

Updated in v11
- Freehand objects can now be edited with an eraser from the action bar.
