# Footnotes

### Easily insert numbered footnotes in a Roam page.

![image](https://user-images.githubusercontent.com/74436347/189387081-fbb7ef64-5fde-441b-97c4-0bc7bae3e520.png)

## 🆕 New in v.6 (July 2026):

- **[Named footnotes](#named-footnotes)**: a note can keep a textual marker, `(bignote)`, instead of a number. Type `[^bignote]` (or `[^bignote: the note text]`) and run the insert command on it, or use `((^bignote: the note text))` in the autocomplete popup. Named notes are never renumbered, are listed after the numbered ones, and the same one can be cited as many times as you like.
- **[Markdown footnotes conversion](#convert-markdown-footnotes)**: the `Footnotes: Convert Markdown footnotes on current page` command turns a pasted document using `[^1]` references and `[^1]: ...` definitions into real footnotes, moving each definition (and its indented paragraphs) into the footnotes section.

### [See changelog here for an overview of updates and new features](https://github.com/fbgallet/roam-extension-footnotes/blob/main/CHANGELOG.md)

## Insert a footnote

![image](https://user-images.githubusercontent.com/74436347/197252568-2788c73e-7ae1-48ca-8aa0-afe06750fe68.png)

Three different way to create a footnote:

1. Run `Footnotes: Insert or remove footnote at current position` command, or press corresponding hotkeys (by default: `Cmd+Shift+f` on MacOS, `Ctrl+Shift+f` on Windows) at the location where you want to insert the note.
2. Type the note text after a double bracket: `((my note...`. You have only to choose the "Create as footnote" option in the autocomplete popup (Arrow up + Enter).
3. (🆕 new in v.5) `/Insert footnote` slash command (just type `/foo`; note that slash command autocomplete works only after a space)

How it works:

- a new block is created, under the header #footnotes (customizable, under a line or not) and focused, to enter the note,
- by default, the footnote will be opened in the right sidebar (🆕 in v.4: in the current view if the corresponding setting is disabled),
- if some text is selected when you press the hotkeys to insert the note, the text is automatically copied into the note (and the note is not opened in the sidebar, since its content is already defined),
- a numbered alias is inserted (in superscript as an option),
- all following notes on the page are automatically renumbered.

You can customize hotkeys for `Footnotes: Insert or remove footnote at current position` command, just like any other command from the command palette, either by searching for "footnotes hotkey" in the command palette, or at the bottom of the extension settings.

## Named footnotes

A footnote doesn't have to be numbered: it can keep a textual marker, like `(bignote)`, which never changes. Two ways to create one:

1. Type `[^bignote]` in your text, place the cursor on it and run the usual insert command (or hotkeys): the reference is replaced by an alias keeping `bignote` as its marker. You can write the note at the same time with `[^bignote: the note text]`.
2. Type `((^bignote: the note text))` — or just `((^bignote))` for an empty note — and choose the "Create as footnote named (bignote)" option in the autocomplete popup.

The `^` is required (it's the Markdown convention for footnotes): without it, `[bignote]` would be indistinguishable from a page reference or from the first half of a `[text](url)` link.

**A name designates one single note.** If `bignote` is already used on the page, a new `[^bignote]` doesn't create a second note: it cites the existing one. So you can refer to the same footnote as many times as you like. Deleting one of those citations only removes the alias; the note itself is deleted when its last citation goes.

Named footnotes never take part in the automatic numbering: inserting or deleting one leaves the numbers of the other notes untouched, and a numbered note inserted next to one ignores it. In the #footnotes section, they are listed after all the numbered notes, in their order of appearance in the page.

Since that section is displayed as a numbered list, a named note would show up as a meaningless "4.". Its label is therefore repeated at the beginning of the note itself (`bignote: the note text`) — this can be disabled in the settings. It is removed again if the note content goes back into the text when you delete the footnote.

A purely numeric marker (`[^1]`, `((^2: ...))`) is what Markdown uses for an ordinary footnote, so it joins the automatic numbering instead of being kept as a name.

## Convert Markdown footnotes

If you paste text using [Markdown footnotes](https://www.markdownguide.org/extended-syntax/#footnotes), run `Footnotes: Convert Markdown footnotes on current page` to convert the whole page at once:

```
Here's a simple footnote,[^1] and here's a longer one.[^bignote]

[^1]: This is the first footnote.

[^bignote]: Here's one with multiple paragraphs and code.

    Indent paragraphs to include them in the footnote.
```

How it works:

- each `[^label]` reference becomes a footnote alias: numbered if the label is a number, named (see above) otherwise. A label already used by a named note on the page points to that note instead of duplicating it,
- each `[^label]: ...` definition block is _moved_ under the #footnotes header, with the `[^label]: ` prefix removed. Its children (the indented paragraphs of the Markdown footnote) come along with it, and its block references stay valid since the block itself is preserved,
- footnotes already present on the page are taken into account: everything ends up numbered in a single continuous sequence, in reading order,
- a reference without a matching definition gets an empty note to fill in later, and a definition that is never cited is left untouched where it is. Both are reported in the notification at the end of the conversion.

## Delete a footnote

Select, in the main text, the number of the note (the selection can be overflowing without problem, but it must contain at most one note number), then press hotkeys to insert/remove a footnote. Or right-click on the footnote number to open block reference context menu and run 'Extensions > Delete footnote' option.

How it works:

- the note block will be deleted (and the whole #footnotes section if there is no more footnotes)
- if there was some content in the note block, it will be inserted in the text body, in place of the alias, or you can choose to replace the alias by the note number in brackets (better for exporting) and keep the note block (see option in settings),
- all following notes on the page are automatically renumbered.

You can also delete footnotes in bulk with `Footnotes: Warning, danger zone! Delete all footnotes on current page or selection` command. It can be useful to export more easily its content to a classic document, since you can replace all alias by the number in brackets.

## Reorder / Renumber footnotes

If you move blocks or parts of text, or if you manually delete notes by mistake, you can reorder the list of notes and correct their numbering.
Simply run `Footnotes: Reorder footnotes on current page` command, from the command palette (Ctrl+P).

## SmartBlocks commands

You can insert or delete a footnote using SmartBlocks commands: `<%INSERTFOOTNOTE%>` and `<%DELETEFOOTNOTE%>`.
To delete a footnote, place the cursor just before the footnote number, search the SmartBlocks and click on its name in the autocomplete box (press enter doesn't work here if you are using superscript footnote, because of the #sup tag autocomplete box)

You will need to create SmartBlocks like this:

```
#SmartBlock Insert footnote
    - <%INSERTFOOTNOTE%>
#SmartBlock Delete footnote
    - <%DELETEFOOTNOTE%>

```

### **How to support my work ?**

Become a [Github sponsor](https://github.com/sponsors/fbgallet), [buy me a coffee](https://buymeacoffee.com/fbgallet) or follow @fbgallet on [X](https://x.com/fbgallet), on [Bluesky](https://bsky.app/profile/fbgallet.bsky.social) or on [Mastodon](https://mastodon.social/@fbgallet)

You can report issues directly in [Github here](https://github.com/fbgallet/roam-extension-footnotes/issues).
