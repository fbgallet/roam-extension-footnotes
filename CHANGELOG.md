## v.6 (July, 2026)

### New features

- Named footnotes: a note can keep a textual marker instead of a number, either by typing `[^label]` (or `[^label: note text]`) and running the insert command on it, or with `((^label: note text))` in the block reference autocomplete. They are never renumbered and are listed after the numbered notes, in order of appearance.
- A named footnote can be cited several times: a label already in use points to the existing note, which is only deleted along with its last citation.
- Option to repeat the label at the beginning of a named note, so it can be told apart in the numbered list of footnotes (enabled by default).
- 'Footnotes: Convert Markdown footnotes on current page' command: converts `[^label]` references and `[^label]: ...` definitions of a pasted Markdown document into footnotes, moving each definition (and its indented paragraphs) into the footnotes section.

### Fixes

- 'Delete all footnotes' no longer rewrites every block of the page, only those actually holding a footnote

## v.5 (February, 2026)

### New features

- '/Insert footnote' slash command
- Option in footnote context menu (as block ref alias) to delete the corresponding footnote
- Option in MultiSelect context menu to delete all footnotes in the selection
- Footnotes section is entirely deleted if there is no more note or content, when deleting footnote(s)

### Fixes

- Fixed footnote inserted sometime at the end of the block

## v.4 (July 11th, 2024)

### Updates

- pre-defined hotkeys have been replaced by a command in command palette and user defined hotkeys
- option to open created footnote in right sidebar or only set focus to it in the current view

## v.3 (October 25th, 2022)

### Enhancement

- note block opened in the right sidebar is automatically focused to write the note.

### Fixes

- option to enable/disable inline footnote with `((` was not working.

## v.2 (October 24st, 2022)

### New features:

- option to insert footnote inline, using the native `((` autocomplete box for block references, on an idea and with an important contribution of [Matt Vogel](https://github.com/8bitgentleman)
- option to replace the alias by the simple note number in brackets, when deleting a note
- new command to delete all footnotes in the current page
- option to add a line above the footnotes header

### Fixes:

- `#sup` tag is now hidden in block references
- notes are not opened in the sidebar if the content is moved from the current selection or entered inline after `((`
