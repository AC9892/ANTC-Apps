# LEGACY UI RULES

Read this first if you have not worked on this project in a while and forgot the backup app's purpose.

This directory is the LEGACY UI version of Binary Inspect.

Hard rules:

1. Do not replace this UI with the live UI.
2. Do not copy the current live `App-BinaryInspect/desktop` compact shell, compact tabs, small fixed window, or current live visual style into this backup.
3. Do not restyle this backup to match the live binary inspector.
4. Do not change this backup's UI direction unless explicitly requested.

What is allowed:

- bug fixes
- parser/backend logic updates
- binary inspection improvements
- extraction/decompile-side behavior improvements
- new capabilities added behind the existing legacy UI
- wiring newer functionality into the backup while preserving the legacy UI structure/look

What is NOT allowed:

- switching this backup to the live compact UI
- copying live `index.html` layout into this backup
- copying live `styles.css` styling direction into this backup
- replacing the legacy header/panel/card layout with the live compact utility layout

Intent:

- this backup must keep the legacy UI
- it may receive newer functionality
- it must NOT become a duplicate of the live UI

If uncertain:

- preserve the existing backup UI
- update logic only
- ask before making visual/UI changes
