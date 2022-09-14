# Footnotes

### Easily insert numbered footnotes in a Roam page.

![image](https://user-images.githubusercontent.com/74436347/189387081-fbb7ef64-5fde-441b-97c4-0bc7bae3e520.png)

### Insert a footnote
Press `Ctrl + Alt + F` at the location where you want to insert the note: 
  - a new block is created, under the header #footnotes (customizable) and opened in the sidebar, to enter the note,
  - if some text is selected when you press the hotkeys to insert the note, the text is automatically copied into the note,
  - a numbered alias is inserted (in superscript as an option),
  - all following notes on the page are automatically renumbered.

### Delete a footnote
Select, in the main text, the number of the note (the selection can be overflowing without problem, but it must contain at most one note number), then press `Ctrl + Alt + F`:
  - the note block will be deleted,
  - if there was some content in the note block, it will be inserted in the text body, in place of the alias,
  - all following notes on the page are automatically renumbered.

### Reorder / Renumber footnotes
If you move blocks or parts of text, or if you manually delete notes by mistake, you can reorder the list of notes and correct their numbering.
Simply run `Footnotes: Reorder footnotes on current page` command, from the command palette (Ctrl+P).

### SmartBlocks commands
You can insert or delete a footnote using SmartBlocks commands: `<%INSERTFOOTNOTE%>` and `<%DELETEFOOTNOTE%>`.
To delete a footnote, place the cursor just before the footnote number, search the SmartBlocks and click on its name in the autocomplete box (press enter doesn't work here if you are using superscript footnote, because of the #sup tag autocomplete box)

You will need to create SmartBlocks like this:
```
#SmartBlock Insert footnote
    - <%INSERTFOOTNOTE%>
#SmartBlock Delete footnote
    - <%DELETEFOOTNOTE%>

```
