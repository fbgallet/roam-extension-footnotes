import {
  getBlockContent,
  deleteBlock,
  getAnyBlockUidInCurrentPage,
  getPageTreeFromAnyBlockUid,
  getBlockUidOnPageByExactText,
  getTreeByUid,
} from "./utils";
import getPageTitleByBlockUid from "roamjs-components/queries/getPageTitleByBlockUid";
import getPageUidByPageTitle from "roamjs-components/queries/getPageUidByPageTitle";
import normalizePageTitle from "roamjs-components/queries/normalizePageTitle";
import createObserver from "roamjs-components/dom/createObserver";

// store observers globally so they can be disconnected
let runners = {
  menuItems: [],
  observers: [],
};

// A footnote label is either a number (auto-numbered notes, renumbered on
// insertion/removal) or free text (named notes, e.g. [(bignote)], which keep
// their label forever). Parentheses and brackets are excluded from the label so
// it can never swallow the surrounding alias syntax.
const supAliasRegex = /\#sup\^\^\[(\([^()\[\]]+\))\]\(\(\([^\)]*\)\)\)\^\^/g;
const aliasRegex = /\[(\([^()\[\]]+\))\]\(\(\([^\)]*\)\)\)/g;
// Matches either form (with or without #sup^^...^^) — use without /g for .test()
const anyAliasPattern =
  /(?:\#sup\^\^)?\[(\([^()\[\]]+\))\]\(\(\([^\)]*\)\)\)(?:\^\^)?/;
// Same as anyAliasPattern but also captures the note UID as group 2
const anyAliasWithUidPattern =
  /(?:\#sup\^\^)?\[\([^()\[\]]+\)\]\(\(\(([^\)]*)\)\)\)(?:\^\^)?/g;
// Same, capturing the label as group 1 and the note UID as group 2
const anyAliasWithLabelPattern =
  /(?:\#sup\^\^)?\[\(([^()\[\]]+)\)\]\(\(\(([^\)]*)\)\)\)(?:\^\^)?/g;
// Markdown-style footnote reference, typed inline or pasted: [^bignote].
// [^bignote: the note text] is a Roam-only extension of it, to declare a named
// note and its content in one go. Label as group 1, optional content as group 2.
const mdRefRegex = /\[\^([^\]\s:]+)(?::[ \t]*([^\]]*))?\]/g;
const supArray = ["#sup^^", "^^"];

// Numbered notes take part in the automatic numbering; named ones never do.
function isNamedLabel(label) {
  return !/^\d+$/.test(label);
}

// The footnotes section is a numbered list, so a named note would show up as a
// meaningless "4." unless its label is repeated in the note itself.
function buildNamedNoteContent(label, content) {
  return labelInNamedNote ? label + ": " + content : content;
}

function stripNoteLabel(content, label) {
  const prefix = label + ":";
  return content.startsWith(prefix)
    ? content.slice(prefix.length).trim()
    : content.trim();
}

// A given name designates one single note: look for an alias already using it.
function findNamedNoteUid(tree, label) {
  for (const block of flattenTreeInOrder(tree)) {
    for (const m of getNamedNotesInBlock(block.string))
      if (m[1] === label) return m[2];
  }
  return null;
}

// ...which means the same named note can be cited several times in the page.
function countNamedNoteAliases(tree, label) {
  let count = 0;
  for (const block of flattenTreeInOrder(tree))
    for (const m of getNamedNotesInBlock(block.string))
      if (m[1] === label) count++;
  return count;
}

let footnotesTag;
let footNotesUid;
let nbInPage = 0;
let shift = 0;
let footNotesUidArray = [];
let namedNotesUidArray = [];
let namedNoteToInsert = null;
let reusedNamedNoteUid = null;
let isSharedNamedNote = false;
let labelInNamedNote;
let isSup = true;
let isToOpenInSidebar;
let footnoteButton;
let inlineNotesOption;
let footnoteButtonSelected;
let noteInline = null;
let replaceBySimpleNumber;
let insertLineBeforeFootnotes;
let currentPos;

class noteInlineObj {
  constructor(content, beginAt, keyboard = false) {
    // ((^bignote: some text)) or ((^bignote)) declares a named footnote;
    // anything else is an ordinary auto-numbered one.
    const named = content.match(/^\^([^:()\[\]]+)(?::[ \t]*([\s\S]*))?$/);
    this.raw = content;
    this.label = named ? named[1].trim() : null;
    this.content = named ? (named[2] ?? "").trim() : content;
    this.beginAt = beginAt;
    this.keyboardTriggered = keyboard;
  }
}

class position {
  constructor(elt = document.activeElement) {
    if (!elt || elt.tagName !== "TEXTAREA") {
      const focusedTextarea = document.querySelector("textarea:focus");
      elt = focusedTextarea || elt;
    }
    this.elt = elt;
    this.s = elt && elt.selectionStart !== null ? elt.selectionStart : 0;
    this.e = elt && elt.selectionEnd !== null ? elt.selectionEnd : 0;

    this.setPos = function (shift = 0) {
      this.elt = document.activeElement;
      this.s = this.elt.selectionStart + shift;
      this.e = this.elt.selectionEnd + shift;
    };
    this.isEgal = function (pos) {
      if (this.elt === pos.elt && this.s === pos.s && this.e === pos.e)
        return true;
      else return false;
    };
    this.hasSelection = function () {
      if (this.s !== this.e) return true;
      else return false;
    };
  }
}

function onKeyDown(e) {
  // Capture cursor position whenever a textarea is focused and a modifier+key
  // combination that could trigger a footnote command is pressed.
  // This covers both Cmd+P (command palette) and the direct hotkey (Cmd+Shift+F
  // or Cmd+Alt+F), capturing position before focus can move away from the textarea.
  if (
    document.activeElement?.tagName === "TEXTAREA" &&
    (e.metaKey || e.ctrlKey)
  ) {
    currentPos = new position();
  }
}

async function insertOrRemoveFootnote(uid) {
  if (uid !== undefined) {
    let content = getBlockContent(uid);
    // Check selection first (with padding for the alias delimiters)
    if (currentPos.hasSelection()) {
      let selection = content.slice(currentPos.s - 2, currentPos.e + 2);
      let label = getNoteLabel(selection);
      if (label !== null) {
        await removeFootNote(uid, label);
        return;
      }
    }
    // Check if cursor is inside a footnote alias (no selection needed)
    const aliasPattern = new RegExp(anyAliasPattern.source, "g");
    let match;
    while ((match = aliasPattern.exec(content)) !== null) {
      if (
        match.index <= currentPos.s &&
        currentPos.s <= match.index + match[0].length
      ) {
        let label = getNoteLabel(match[0]);
        if (label !== null) {
          await removeFootNote(uid, label);
          return;
        }
      }
    }
    // No alias here: if the cursor sits on a markdown-style [^label] reference,
    // turn it into a named footnote keeping "label" as its marker.
    namedNoteToInsert = getMarkdownRefAtCursor(content, currentPos.s);
    await insertFootNote(uid);
  }
}

function getMarkdownRefAtCursor(content, cursor) {
  const refPattern = new RegExp(mdRefRegex.source, "g");
  let match;
  while ((match = refPattern.exec(content)) !== null) {
    if (match.index <= cursor && cursor <= match.index + match[0].length)
      return {
        label: match[1],
        content: (match[2] ?? "").trim(),
        start: match.index,
        end: match.index + match[0].length,
      };
  }
  return null;
}

async function initAndGetTree(uid) {
  nbInPage = 0;
  shift = 0;
  let pageTitle = getPageTitleByBlockUid(uid);
  footNotesUid = await getFootNotesHeaderUid(pageTitle);
  return getPageTreeFromAnyBlockUid(uid);
}

async function insertFootNote(uid) {
  const namedLabel =
    namedNoteToInsert !== null && isNamedLabel(namedNoteToInsert.label)
      ? namedNoteToInsert.label
      : noteInline !== null && noteInline.label !== null
        ? noteInline.label
        : null;
  const isNamed = namedLabel !== null;
  let tree = await initAndGetTree(uid);
  reusedNamedNoteUid = isNamed ? findNamedNoteUid(tree, namedLabel) : null;
  await processNotesInTree(tree, uid, insertNoteInBlock);
  namedNoteToInsert = null;
  reusedNamedNoteUid = null;
  // A named note is appended at the end of the footnotes section, so a full
  // pass is needed to put it back in order of appearance in the page.
  if (isNamed) await reorderFootNotes(uid);
}

async function processNotesInTree(
  tree,
  triggerUid,
  callback,
  index = -1,
  removeAll = false,
  selectedUids = null,
) {
  tree = tree.sort((a, b) => a.order - b.order);
  for (let i = 0; i < tree.length; i++) {
    let content = tree[i].string;
    let notesNbArray = getNotesNumberInBlock(content);
    let nbInBlock = notesNbArray.length;
    const isTarget =
      tree[i].uid === triggerUid ||
      (removeAll && (selectedUids === null || selectedUids.has(tree[i].uid)));
    if (isTarget) {
      content = await callback(tree[i].uid, content, index, removeAll);
      nbInBlock += shift;
    }
    // A block may hold only named notes: it has no number to contribute but
    // still has to be visited, otherwise its notes escape the reordering.
    let namedInBlock = getNamedNotesInBlock(content).length;
    if ((nbInBlock !== 0 || namedInBlock !== 0) && !removeAll) {
      if (triggerUid === null || removeAll) {
        await callback(tree[i].uid, content, notesNbArray, index, removeAll);
      } else if (shift !== 0 && nbInBlock !== 0 && tree[i].uid !== triggerUid) {
        content = renumberNotes(content, nbInPage, nbInBlock);
        await window.roamAlphaAPI.updateBlock({
          block: {
            uid: tree[i].uid,
            string: content,
          },
        });
      }
      nbInPage += nbInBlock;
    }
    let subTree = tree[i].children;
    if (subTree) {
      await processNotesInTree(
        subTree,
        triggerUid,
        callback,
        index,
        removeAll,
        selectedUids,
      );
    }
  }
}

async function insertNoteInBlock(uid, content) {
  let left = "",
    right = "";
  let selection = "";
  let label = null;
  if (namedNoteToInsert !== null) {
    // The user put the cursor on a markdown-style [^label] reference: the
    // reference itself is what gets replaced by the alias.
    left = content.slice(0, namedNoteToInsert.start);
    right = content.slice(namedNoteToInsert.end);
    label = namedNoteToInsert.label;
    selection = namedNoteToInsert.content;
  } else if (noteInline !== null) {
    let beginAt = noteInline.beginAt - 2;
    let endAt = beginAt;
    if (!noteInline.keyboardTriggered) {
      endAt += noteInline.raw.length + 4;
    }
    left = content.slice(0, beginAt);
    right = content.slice(endAt);
    selection = noteInline.content;
    label = noteInline.label;
  } else {
    left = content.slice(0, currentPos.s);
    right = content.slice(currentPos.e);
    if (currentPos.hasSelection())
      selection = content.slice(currentPos.s, currentPos.e);
  }
  let noteUid;
  // A numeric label ([^1], ((^12: …))) is what Markdown uses for an ordinary
  // footnote, so it goes through the auto-numbering path like any other.
  if (label !== null && isNamedLabel(label)) {
    // Named notes never shift the numbering around them.
    shift = 0;
    if (reusedNamedNoteUid !== null) {
      // That name is already used on the page: cite the existing note instead
      // of creating a second one under the same label.
      noteUid = reusedNamedNoteUid;
      const existing = getBlockContent(noteUid);
      // Only fill it in if it is still empty: never overwrite a written note.
      if (selection.length !== 0 && stripNoteLabel(existing, label) === "")
        await window.roamAlphaAPI.updateBlock({
          block: {
            uid: noteUid,
            string: buildNamedNoteContent(label, selection),
          },
        });
      await insertAliasInBlock(uid, left, right, label, noteUid);
      return content; // nothing to write in it, so don't steal the focus
    }
    noteUid = await createNewNote(
      "last",
      buildNamedNoteContent(label, selection),
    );
    await insertAliasInBlock(uid, left, right, label, noteUid);
  } else {
    let nbLeft = getNotesNumberInBlock(left).length;
    let newNoteNb = nbLeft + nbInPage + 1;
    let nbRight = getNotesNumberInBlock(right).length;
    shift = 1;
    if (nbRight >= 1) right = renumberNotes(right, newNoteNb, nbRight);
    noteUid = await createNewNote(newNoteNb - 1, selection);
    await insertAliasInBlock(uid, left, right, newNoteNb, noteUid);
  }
  if (selection.length === 0)
    isToOpenInSidebar ? openNoteInSidebar(noteUid) : focusOnNote(noteUid);
  return content;
}

async function insertAliasInBlock(uid, left, right, nb, noteUid) {
  if (isSup) {
    left += supArray[0];
    right = supArray[1] + right;
  }
  await window.roamAlphaAPI.updateBlock({
    block: {
      uid: uid,
      string: left + "[(" + nb + ")](((" + noteUid + ")))" + right,
    },
  });
}

// Only auto-numbered notes: named ones must not consume a number.
function getNotesNumberInBlock(content) {
  if (content.length === 0) return [];
  let regex = /\[\(\d+\)\]\(\(\(/g;
  let m = [...content.matchAll(regex)];
  return m;
}

// The mirror image: only the named notes, with their label and UID.
function getNamedNotesInBlock(content) {
  if (!content || content.length === 0) return [];
  anyAliasWithLabelPattern.lastIndex = 0;
  return [...content.matchAll(anyAliasWithLabelPattern)].filter((m) =>
    isNamedLabel(m[1]),
  );
}

// Label of the first complete footnote alias found: a number as a string for a
// numbered note, the text marker for a named one.
function getNoteLabel(content) {
  const m = content.match(new RegExp(anyAliasWithLabelPattern.source));
  return m ? m[1] : null;
}

function renumberNotes(content, startNb, nbOfNotes) {
  if (shift > 0) {
    for (let i = nbOfNotes - 1; i >= 0; i--) {
      content = replaceNoteNumber(content, startNb, i);
    }
  } else {
    for (let i = 0; i < nbOfNotes; i++) {
      content = replaceNoteNumber(content, startNb + 2, i);
    }
  }
  function replaceNoteNumber(content, s, i) {
    let currentNb = s + i;
    let newNb = currentNb + shift;
    return content.replace("[(" + currentNb + ")]", "[(" + newNb + ")]");
  }
  return content;
}

// order is a 0-based position for a numbered note, or "last" for a named one.
async function createNewNote(order = 0, content) {
  let uid = window.roamAlphaAPI.util.generateUID();
  await window.roamAlphaAPI.createBlock({
    location: { "parent-uid": footNotesUid, order: order },
    block: { uid: uid, string: content },
  });
  return uid;
}

async function removeFootNote(startUid, index) {
  let tree = await initAndGetTree(startUid);
  // Dropping one citation of a named note must not delete a note block that
  // the rest of the page still refers to.
  isSharedNamedNote =
    index !== -1 &&
    index !== null &&
    isNamedLabel(String(index)) &&
    countNamedNoteAliases(tree, String(index)) > 1;
  await processNotesInTree(tree, startUid, removeFootNoteFromBlock, index);
  isSharedNamedNote = false;
  await cleanupFootNotesHeaderIfEmpty(startUid);
}

async function removeAllFootNotes(startUid) {
  let tree = await initAndGetTree(startUid);
  await processNotesInTree(tree, startUid, removeFootNoteFromBlock, -1, true);
  await cleanupFootNotesHeaderIfEmpty(startUid);
}

async function removeFootNotesInSelection(startUid, selectedUids) {
  let tree = await initAndGetTree(startUid);
  await processNotesInTree(
    tree,
    startUid,
    removeFootNoteFromBlock,
    -1,
    true,
    selectedUids,
  );
  await reorderFootNotes(startUid);
  await cleanupFootNotesHeaderIfEmpty(startUid);
}

async function cleanupFootNotesHeaderIfEmpty(anyUid) {
  const pageTitle = getPageTitleByBlockUid(anyUid);
  const headerUid = getBlockUidOnPageByExactText(
    footnotesTag,
    normalizePageTitle(pageTitle),
  );
  if (!headerUid) return;
  const headerTree = getTreeByUid(headerUid)?.[0];
  if (headerTree?.children?.length) return; // still has footnote children
  // Locate the separator before deleting, using page tree (which includes order)
  let separatorUid = null;
  if (insertLineBeforeFootnotes) {
    const pageChildren = getPageTreeFromAnyBlockUid(anyUid);
    // Find the header in the page children to get its order
    const headerEntry = pageChildren.find((b) => b.uid === headerUid);
    if (headerEntry) {
      const sep = pageChildren.find(
        (b) => b.order === headerEntry.order - 1 && b.string === "---",
      );
      if (sep) separatorUid = sep.uid;
    }
  }
  await deleteBlock(headerUid);
  if (separatorUid) await deleteBlock(separatorUid);
}

async function removeFootNoteFromBlock(uid, content, noteIndex, removeAll) {
  const initialContent = content;
  if (removeAll) {
    if (!replaceBySimpleNumber) {
      let m;
      const deletePromises = [];
      while ((m = anyAliasWithUidPattern.exec(content)) !== null) {
        deletePromises.push(deleteBlock(m[1]));
      }
      anyAliasWithUidPattern.lastIndex = 0;
      await Promise.all(deletePromises);
    }
    let replaceGroup = "";
    if (replaceBySimpleNumber) replaceGroup = "$1";
    content = content.replace(supAliasRegex, replaceGroup);
    content = content.replace(aliasRegex, replaceGroup);
  } else {
    let leftSup = 0;
    let rightSup = 0;
    let label;
    if (noteIndex !== -1 && noteIndex !== null) label = String(noteIndex);
    else label = String(nbInPage + 1);
    let index = content.indexOf("[(" + label + ")]");
    if (content.slice(index - 6, index) === "#sup^^") {
      leftSup = 6;
      rightSup = 2;
    }
    let uidShift = index + label.length + 7;
    let noteUid = content.substr(uidShift, 9);
    let noteContent = getBlockContent(noteUid);
    let right = content.slice(uidShift + 12 + rightSup);
    if (isNamedLabel(label)) {
      // Removing a named note leaves the numbering of the page untouched.
      shift = 0;
      // The label is a marker, not part of the note: drop it before the text
      // goes back into the body of the page.
      noteContent = stripNoteLabel(noteContent, label);
      // The note survives its other citations, so nothing of it belongs here.
      if (isSharedNamedNote) noteContent = "";
    } else {
      let nbRightNotes = getNotesNumberInBlock(right).length;
      shift = -1;
      right = renumberNotes(right, parseInt(label) - 1, nbRightNotes);
    }
    if (noteContent.length !== 0 && !removeAll)
      noteContent = "(deleted note: " + noteContent + ")";
    if (replaceBySimpleNumber) noteContent = "(" + label + ")";
    content = content.slice(0, index - leftSup) + noteContent + right;
    if (!replaceBySimpleNumber && !isSharedNamedNote)
      await deleteBlock(noteUid);
  }
  // "Delete all" runs over every block of the page, footnote blocks included:
  // only touch those that actually held an alias.
  if (content !== initialContent)
    await window.roamAlphaAPI.updateBlock({
      block: {
        uid: uid,
        string: content,
      },
    });
  return content;
}

async function reorderFootNotes(uid) {
  let tree = await initAndGetTree(uid);
  footNotesUidArray = [];
  namedNotesUidArray = [];
  await processNotesInTree(tree, null, reorderNotesInBlock);
  reorderFootNoteBlock(footNotesUid);
}

// Rewrites a block in a single pass: numbered aliases get the number matching
// their rank in the page, named ones are left untouched and only collected.
async function reorderNotesInBlock(uid, content) {
  let out = "";
  let last = 0;
  let rank = 0;
  let toUpdate = false;
  let m;
  anyAliasWithLabelPattern.lastIndex = 0;
  while ((m = anyAliasWithLabelPattern.exec(content)) !== null) {
    const [alias, label, noteUid] = m;
    if (isNamedLabel(label)) {
      namedNotesUidArray.push(noteUid);
      continue;
    }
    const neededNb = nbInPage + rank + 1;
    rank++;
    footNotesUidArray.push(noteUid);
    if (parseInt(label) !== neededNb) {
      toUpdate = true;
      console.log(
        "Note " + label + " renumbered to " + neededNb + " in " + uid,
      );
      out +=
        content.slice(last, m.index) +
        alias.replace("(" + label + ")", "(" + neededNb + ")");
      last = m.index + alias.length;
    }
  }
  if (toUpdate)
    await window.roamAlphaAPI.updateBlock({
      block: {
        uid: uid,
        string: out + content.slice(last),
      },
    });
  return toUpdate;
}

// Numbered notes in page order first, then named ones in order of appearance,
// then whatever else already lives under the header.
function reorderFootNoteBlock(uid) {
  const children = getTreeByUid(uid)?.[0]?.children ?? [];
  const childUids = new Set(children.map((c) => c.uid));
  const ordered = [];
  const seen = new Set();
  const push = (noteUid) => {
    if (!childUids.has(noteUid) || seen.has(noteUid)) return;
    seen.add(noteUid);
    ordered.push(noteUid);
  };
  footNotesUidArray.forEach(push);
  namedNotesUidArray.forEach(push);
  children.forEach((child) => push(child.uid));
  window.roamAlphaAPI.data.block.reorderBlocks({
    location: { "parent-uid": uid },
    blocks: ordered,
  });
}

// === Markdown footnotes conversion ===============================================
// Markdown definition block: [^1]: content (the "content" can be empty if the
// footnote body only lives in indented paragraphs, i.e. children blocks)
const mdDefRegex = /^\s*\[\^([^\]\s:]+)\]:[ \t]*([\s\S]*)$/;
// Either an existing footnote alias (label as group 1, uid as group 2) or a
// markdown reference (label as group 3, inline content as group 4), to rewrite
// a block in one pass.
const footnoteTokenRegex =
  /(?:\#sup\^\^)?\[\(([^()\[\]]+)\)\]\(\(\(([^\)]*)\)\)\)(?:\^\^)?|\[\^([^\]\s:]+)(?::[ \t]*([^\]]*))?\]/g;

function flattenTreeInOrder(tree, result = []) {
  const sorted = [...tree].sort((a, b) => a.order - b.order);
  for (const node of sorted) {
    result.push(node);
    if (node.children) flattenTreeInOrder(node.children, result);
  }
  return result;
}

function collectSubtreeUids(node, set = new Set()) {
  set.add(node.uid);
  if (node.children) node.children.forEach((c) => collectSubtreeUids(c, set));
  return set;
}

function buildAlias(label, noteUid) {
  const alias = "[(" + label + ")](((" + noteUid + ")))";
  return isSup ? supArray[0] + alias + supArray[1] : alias;
}

function showToast(content, intent = "success") {
  const render = window.roamAlphaAPI.ui.components?.renderToast;
  if (render) render({ id: "footnotes-convert", content, intent });
  else console.log(content);
}

async function convertMarkdownFootnotes(startUid) {
  const pageTitle = getPageTitleByBlockUid(startUid);
  const blocks = flattenTreeInOrder(getPageTreeFromAnyBlockUid(startUid));

  // 1. Collect the markdown definitions. Their whole subtree is excluded from
  // the reference scan: children are the footnote's indented paragraphs.
  const definitions = new Map(); // label => { uid, content }
  const excludedUids = new Set();
  for (const block of blocks) {
    const m = (block.string || "").match(mdDefRegex);
    if (!m) continue;
    if (!definitions.has(m[1]))
      definitions.set(m[1], { uid: block.uid, content: m[2].trim() });
    collectSubtreeUids(block, excludedUids);
  }

  // 2. Without a single definition, any [^...] on the page is more likely to be
  // ordinary text than a footnote, so leave everything alone.
  if (definitions.size === 0) {
    showToast("No Markdown footnote to convert on this page.", "warning");
    return;
  }

  footNotesUid = await getFootNotesHeaderUid(pageTitle);

  // 3. Walk the page in document order, rewriting markdown references into
  // footnote aliases. A numeric label ([^1]) is what Markdown uses for an
  // ordinary footnote, so it joins the auto-numbered sequence — together with
  // the footnotes already on the page. A textual label ([^bignote]) is kept as
  // is and becomes a named note.
  const orderedNumbered = [];
  const orderedNamed = [];
  const noteUidByLabel = new Map();
  const orphanLabels = new Set();
  const movedLabels = new Set();
  const updates = [];
  let counter = 0;
  let convertedNb = 0;

  // A name designates one single note: if the page already holds a (bignote)
  // alias, [^bignote] references must point to that note, not to a copy.
  for (const block of blocks) {
    if (excludedUids.has(block.uid)) continue;
    for (const m of getNamedNotesInBlock(block.string))
      if (!noteUidByLabel.has(m[1])) noteUidByLabel.set(m[1], m[2]);
  }

  for (const block of blocks) {
    if (excludedUids.has(block.uid) || !block.string) continue;
    const content = block.string;
    let out = "";
    let last = 0;
    let changed = false;
    let m;
    footnoteTokenRegex.lastIndex = 0;
    while ((m = footnoteTokenRegex.exec(content)) !== null) {
      // 3a. Footnote already in the extension format.
      if (m[1] !== undefined) {
        if (isNamedLabel(m[1])) {
          orderedNamed.push(m[2]);
          continue; // named notes keep their label: nothing to rewrite
        }
        counter++;
        orderedNumbered.push(m[2]);
        const renumbered = m[0].replace(/\[\(\d+\)\]/, "[(" + counter + ")]");
        if (renumbered !== m[0]) {
          changed = true;
          out += content.slice(last, m.index) + renumbered;
          last = m.index + m[0].length;
        }
        continue;
      }
      // 3b. Markdown reference.
      const label = m[3];
      const inlineContent = (m[4] ?? "").trim();
      const named = isNamedLabel(label);
      let noteUid = noteUidByLabel.get(label);
      if (noteUid === undefined) {
        const definition = definitions.get(label);
        if (definition) {
          noteUid = definition.uid;
          movedLabels.add(label);
        } else {
          // Reference without definition: keep whatever [^label: text] carried,
          // otherwise create an empty note to fill in later rather than
          // dropping the reference on the floor.
          if (!inlineContent) orphanLabels.add(label);
          noteUid = window.roamAlphaAPI.util.generateUID();
          await window.roamAlphaAPI.createBlock({
            location: { "parent-uid": footNotesUid, order: "last" },
            block: {
              uid: noteUid,
              string: named
                ? buildNamedNoteContent(label, inlineContent)
                : inlineContent,
            },
          });
        }
        noteUidByLabel.set(label, noteUid);
      } else if (!named) {
        // Same numeric label cited twice: numbering needs one block per alias,
        // so point to the original note with a block reference.
        noteUid = window.roamAlphaAPI.util.generateUID();
        await window.roamAlphaAPI.createBlock({
          location: { "parent-uid": footNotesUid, order: "last" },
          block: {
            uid: noteUid,
            string: "((" + noteUidByLabel.get(label) + "))",
          },
        });
      }
      if (named) orderedNamed.push(noteUid);
      else {
        counter++;
        orderedNumbered.push(noteUid);
      }
      out +=
        content.slice(last, m.index) +
        buildAlias(named ? label : counter, noteUid);
      last = m.index + m[0].length;
      changed = true;
      convertedNb++;
    }
    if (changed)
      updates.push({ uid: block.uid, string: out + content.slice(last) });
  }

  for (const update of updates) {
    await window.roamAlphaAPI.updateBlock({ block: update });
  }

  // 4. Move each cited definition block (with its indented paragraphs) under
  // the footnotes header, replacing the "[^label]: " prefix by the note marker.
  for (const label of movedLabels) {
    const definition = definitions.get(label);
    await window.roamAlphaAPI.updateBlock({
      block: {
        uid: definition.uid,
        string: isNamedLabel(label)
          ? buildNamedNoteContent(label, definition.content)
          : definition.content,
      },
    });
    await window.roamAlphaAPI.moveBlock({
      location: { "parent-uid": footNotesUid, order: "last" },
      block: { uid: definition.uid },
    });
  }

  // 5. Numbered notes in reading order, then named ones in order of appearance.
  footNotesUidArray = orderedNumbered;
  namedNotesUidArray = orderedNamed;
  reorderFootNoteBlock(footNotesUid);

  const unused = [...definitions.keys()].filter((l) => !movedLabels.has(l));
  let message = convertedNb + " Markdown footnote(s) converted.";
  if (orphanLabels.size)
    message +=
      " Empty note created (no definition found) for: " +
      [...orphanLabels].join(", ") +
      ".";
  if (unused.length)
    message +=
      " Definition(s) left in place (never cited): " + unused.join(", ") + ".";
  showToast(
    message,
    orphanLabels.size || unused.length ? "warning" : "success",
  );
}

function openNoteInSidebar(uid) {
  window.roamAlphaAPI.ui.rightSidebar.addWindow({
    window: { type: "block", "block-uid": uid },
  });
  setTimeout(() => {
    const sidebarWindows = window.roamAlphaAPI.ui.rightSidebar.getWindows();
    let windowId;
    for (let i = 0; i < sidebarWindows.length; i++) {
      if (sidebarWindows[i]["block-uid"] === uid) {
        windowId = sidebarWindows[i]["window-id"];
        break;
      }
    }
    window.roamAlphaAPI.ui.setBlockFocusAndSelection({
      location: { "block-uid": uid, "window-id": windowId },
    });
  }, 100);
}

function focusOnNote(uid) {
  const currentWindowId =
    window.roamAlphaAPI.ui.getFocusedBlock()?.["window-id"];
  if (!currentWindowId) return;
  setTimeout(() => {
    window.roamAlphaAPI.ui.setBlockFocusAndSelection({
      location: { "block-uid": uid, "window-id": currentWindowId },
    });
  }, 100);
}

async function getFootNotesHeaderUid(pageTitle) {
  let uid = getBlockUidOnPageByExactText(
    footnotesTag,
    normalizePageTitle(pageTitle),
  );
  if (uid === null) return createFootNotesHeader(pageTitle);
  else return uid;
}

async function createFootNotesHeader(pageTitle) {
  let pageUid = getPageUidByPageTitle(pageTitle);
  if (insertLineBeforeFootnotes) {
    let lineUid = window.roamAlphaAPI.util.generateUID();
    await window.roamAlphaAPI.createBlock({
      location: { "parent-uid": pageUid, order: "last" },
      block: { uid: lineUid, string: "---" },
    });
  }
  let uid = window.roamAlphaAPI.util.generateUID();
  await window.roamAlphaAPI.createBlock({
    location: { "parent-uid": pageUid, order: "last" },
    block: { uid: uid, string: footnotesTag, "children-view-type": "numbered" },
  });
  return uid;
}

// get setting from previous version
function getHotkeys(evt) {
  if (evt === "Ctrl + Alt + F") return "alt";
  else return "shift";
}

function createFootnoteButton(text, label = null) {
  const footnote = document.createElement("div");
  footnote.className = "dont-unfocus-block create-footnote";
  footnote.style = "border-radius: 2px; padding: 6px; cursor: pointer;";
  footnote.title = text;

  const markup = `
        <div class="rm-autocomplete-result">
            <span>${text}</span>
        </div>
        <div class="bp3-text-overflow-ellipsis" style="color: rgb(129, 145, 157);">${
          label ? `Create as footnote named (${label})` : "Create as footnote"
        }</div>
  `;

  footnote.innerHTML = markup;
  return footnote;
}

function getInlineNote() {
  const textArea =
    document.querySelector("textarea:focus") ||
    document.querySelectorAll("textarea")[0];
  if (!textArea) return new noteInlineObj("", 0);
  let content = textArea.value;
  let cursorPos = textArea.selectionStart;
  let begin = content.slice(0, cursorPos).lastIndexOf("((") + 2;
  let noteStr = content.slice(begin, cursorPos);
  if (content.slice(begin - 2, begin) !== "((") noteStr = "";
  return new noteInlineObj(noteStr, begin);
}

let acKeyHandler = null;
let acUid = null;

function isRoamFirstItemHighlighted(ac) {
  const firstRoamItem = ac.querySelector(":scope > div:not(.create-footnote)");
  return (
    firstRoamItem &&
    firstRoamItem.style.backgroundColor === "rgb(213, 218, 223)"
  );
}

function clearRoamHighlight(ac) {
  const items = ac.querySelectorAll(":scope > div:not(.create-footnote)");
  items.forEach(function (item) {
    if (item.style.backgroundColor === "rgb(213, 218, 223)") {
      item.style.backgroundColor = "";
    }
  });
}

function installAcKeyHandler(uid) {
  removeAcKeyHandler();
  acUid = uid;
  footnoteButtonSelected = false;
  acKeyHandler = function (e) {
    const acRoot = document.getElementsByClassName(
      "rm-autocomplete__results",
    )[0];
    if (!acRoot) {
      removeAcKeyHandler();
      return;
    }
    const ac =
      acRoot.querySelector(".rm-autocomplete__results-scroll") || acRoot;
    if (e.key === "ArrowUp") {
      if (footnoteButtonSelected) {
        // Already on our button — let it pass so Roam does nothing visible
      } else if (isRoamFirstItemHighlighted(ac)) {
        // Roam's top item is selected: intercept to move to our button
        e.preventDefault();
        e.stopPropagation();
        clearRoamHighlight(ac);
        footnoteButton.setAttribute(
          "style",
          "border-radius: 2px; padding: 6px; cursor: pointer; background-color: rgb(213, 218, 223);",
        );
        footnoteButtonSelected = true;
      }
      // Otherwise: let Roam handle ArrowUp normally
    } else if (e.key === "ArrowDown") {
      if (footnoteButtonSelected) {
        // Leave our button: clear highlight, let Roam handle the down arrow
        footnoteButton.setAttribute(
          "style",
          "border-radius: 2px; padding: 6px; cursor: pointer; background-color: inherit;",
        );
        footnoteButtonSelected = false;
      }
      // Let Roam handle ArrowDown normally in all cases
    } else if (
      footnoteButtonSelected &&
      (e.key === "Enter" || e.key === "Tab")
    ) {
      e.preventDefault();
      e.stopPropagation();
      footnoteButtonSelected = false;
      noteInline.keyboardTriggered = true;
      namedNoteToInsert = null;
      removeAcKeyHandler();
      insertFootNote(acUid);
    }
  };
  // Capture phase: fires before Roam's own handlers
  document.addEventListener("keydown", acKeyHandler, true);
}

function removeAcKeyHandler() {
  if (acKeyHandler) {
    document.removeEventListener("keydown", acKeyHandler, true);
    acKeyHandler = null;
  }
}

function addAutocompleteObserver() {
  const autocompleteObserver = createObserver(setAutocompleteObserver);
  // save observers globally so they can be disconnected later
  runners["observers"] = [autocompleteObserver];
}
function disconnectAutocompleteObserver() {
  // loop through observers and disconnect
  for (let index = 0; index < runners["observers"].length; index++) {
    const element = runners["observers"][index];
    element.disconnect();
  }
}

function setAutocompleteObserver() {
  const blockAutocomplete = document.getElementsByClassName(
    "rm-autocomplete__results",
  )[0];
  if (!blockAutocomplete) return;

  // Check if this is a block search autocomplete (not page search)
  const footerTitle = blockAutocomplete.querySelector(
    ".rm-autocomplete-footer__title",
  );
  if (!footerTitle || !footerTitle.textContent.includes("Block search")) return;

  // Insert into the scroll container (new Roam structure)
  const scrollContainer = blockAutocomplete.querySelector(
    ".rm-autocomplete__results-scroll",
  );
  if (!scrollContainer) return;

  let uid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
  noteInline = getInlineNote();
  // ((^label)) alone is enough to declare a named note, its content can be empty
  if (noteInline.raw.length === 0) return;

  let hasCreateNoteItem = scrollContainer.querySelector(".create-footnote");
  if (hasCreateNoteItem !== null) {
    if (hasCreateNoteItem.parentNode === scrollContainer) {
      scrollContainer.removeChild(hasCreateNoteItem);
    }
  }
  footnoteButton = scrollContainer.insertAdjacentElement(
    "afterbegin",
    createFootnoteButton(noteInline.content, noteInline.label),
  );
  // Only install the capture-phase handler once (first time button appears)
  if (!hasCreateNoteItem) {
    installAcKeyHandler(uid);
  }
  footnoteButton.addEventListener(
    "click",
    function () {
      namedNoteToInsert = null;
      removeAcKeyHandler();
      insertFootNote(uid);
    },
    { once: true },
  );
}

const panelConfig = {
  tabTitle: "Footnotes",
  settings: [
    {
      id: "footnotesHeader",
      name: "Footnotes header",
      description: "Text inserted as the parent block of footnotes:",
      action: {
        type: "input",
        onChange: (evt) => {
          footnotesTag = evt.target.value;
        },
      },
    },
    {
      id: "insertLine",
      name: "Insert a line above footnotes header",
      description:
        "Insert a block drawing a line just above the footnotes header, at the bottom of the page:",
      action: {
        type: "switch",
        onChange: (evt) => {
          insertLineBeforeFootnotes = !insertLineBeforeFootnotes;
        },
      },
    },
    {
      id: "supNotes",
      name: "Superscript note number",
      description:
        "Display alias note number as superscript (using #sup^^ ^^):",
      action: {
        type: "switch",
        onChange: (evt) => {
          isSup = !isSup;
        },
      },
    },
    {
      id: "labelInNote",
      name: "Repeat the label in named notes",
      description:
        "Prefix a named footnote with its own label ('bignote: the note text'), since the footnotes list numbers its items and can't display the label by itself:",
      action: {
        type: "switch",
        onChange: (evt) => {
          labelInNamedNote = !labelInNamedNote;
        },
      },
    },
    {
      id: "inSidebar",
      name: "Open in Sidebar",
      description: "Open created footnote in right Sidebar:",
      action: {
        type: "switch",
        onChange: (evt) => {
          isToOpenInSidebar = !isToOpenInSidebar;
        },
      },
    },
    {
      id: "inlineNotes",
      name: "Inline footnotes creation",
      description:
        "Add an option to block reference autocomplete box to create a footnote from the text entered between (( )):",
      action: {
        type: "switch",
        onChange: (evt) => {
          inlineNotesOption = !inlineNotesOption;
          if (inlineNotesOption) addAutocompleteObserver();
          else disconnectAutocompleteObserver();
        },
      },
    },
    {
      id: "replaceByNumber",
      name: "Deleted alias to number",
      description:
        "When deleting a footnote, replace the alias by a simple note number in brackets and does not delete the note block nor its content:",
      action: {
        type: "switch",
        onChange: (evt) => {
          replaceBySimpleNumber = !replaceBySimpleNumber;
        },
      },
    },
  ],
};

export default {
  onload: async ({ extensionAPI }) => {
    extensionAPI.settings.panel.create(panelConfig);
    if (extensionAPI.settings.get("footnotesHeader") === null)
      await extensionAPI.settings.set("footnotesHeader", "#footnotes");
    footnotesTag = extensionAPI.settings.get("footnotesHeader");
    if (extensionAPI.settings.get("supNotes") === null)
      await extensionAPI.settings.set("supNotes", true);
    isSup = extensionAPI.settings.get("supNotes");
    if (extensionAPI.settings.get("labelInNote") === null)
      await extensionAPI.settings.set("labelInNote", true);
    labelInNamedNote = extensionAPI.settings.get("labelInNote");
    if (extensionAPI.settings.get("inSidebar") === null)
      await extensionAPI.settings.set("inSidebar", true);
    isToOpenInSidebar = extensionAPI.settings.get("inSidebar");
    if (extensionAPI.settings.get("inlineNotes") === null)
      await extensionAPI.settings.set("inlineNotes", true);
    inlineNotesOption = extensionAPI.settings.get("inlineNotes");
    if (extensionAPI.settings.get("replaceByNumber") === null)
      await extensionAPI.settings.set("replaceByNumber", false);
    replaceBySimpleNumber = extensionAPI.settings.get("replaceByNumber");
    if (extensionAPI.settings.get("insertLine") === null)
      await extensionAPI.settings.set("insertLine", true);
    insertLineBeforeFootnotes = extensionAPI.settings.get("insertLine");

    const defaultFirstKey = window.roamAlphaAPI.platform.isPC ? "ctrl" : "cmd";
    const defaultSecondKey = getHotkeys(extensionAPI.settings.get("hotkeys"));
    extensionAPI.settings.set("hotkeys", null);
    extensionAPI.ui.commandPalette.addCommand({
      label: "Footnotes: Insert or remove footnote at current position",
      callback: () => {
        noteInline = null;
        // currentPos is captured by onKeyDown whenever a Ctrl/Cmd key combo fires
        // while a textarea is focused (covers both Cmd+P and the direct hotkey).
        // Fall back to capturing now only if currentPos was never set (edge case).
        if (!currentPos) currentPos = new position();
        let startUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
        if (startUid) insertOrRemoveFootnote(startUid);
      },
      "default-hotkey": `${defaultFirstKey}-${defaultSecondKey}-f`,
    });
    extensionAPI.ui.commandPalette.addCommand({
      label: "Footnotes: Reorder footnotes on current page",
      callback: async () => {
        let uid = await getAnyBlockUidInCurrentPage();
        reorderFootNotes(uid);
      },
    });
    extensionAPI.ui.commandPalette.addCommand({
      label: "Footnotes: Convert Markdown footnotes on current page",
      callback: async () => {
        let uid = await getAnyBlockUidInCurrentPage();
        if (uid) convertMarkdownFootnotes(uid);
      },
    });
    extensionAPI.ui.commandPalette.addCommand({
      label:
        "Footnotes: Warning, danger zone! Delete all footnotes on current page or selection",
      callback: async () => {
        const selected = window.roamAlphaAPI.ui.multiselect.getSelected();
        if (selected.length > 0) {
          const startUid = selected[0]["block-uid"];
          const selectedUids = new Set(selected.map((b) => b["block-uid"]));
          removeFootNotesInSelection(startUid, selectedUids);
        } else {
          let uid = await getAnyBlockUidInCurrentPage();
          removeAllFootNotes(uid);
        }
      },
    });
    document.addEventListener("keydown", onKeyDown);

    const insertCmd = {
      text: "INSERTFOOTNOTE",
      help: "Insert automatically numbered footnote (requires the Footnotes extension)",
      handler: (context) => () => {
        noteInline = null;
        currentPos = new position();
        currentPos.s = context.currentContent.length;
        currentPos.e = currentPos.s;
        insertOrRemoveFootnote(context.targetUid);
        return "";
      },
    };
    const deleteCmd = {
      text: "DELETEFOOTNOTE",
      help: "Delete numbered footnote (requires the Footnotes extension)",
      handler: (context) => () => {
        currentPos = new position();
        currentPos.s = context.currentContent.length - 2;
        currentPos.e = currentPos.s + 6;
        insertOrRemoveFootnote(context.targetUid);
        return "";
      },
    };
    if (window.roamjs?.extension?.smartblocks) {
      window.roamjs.extension.smartblocks.registerCommand(insertCmd);
      window.roamjs.extension.smartblocks.registerCommand(deleteCmd);
    } else {
      document.body.addEventListener(`roamjs:smartblocks:loaded`, () => {
        window.roamjs?.extension.smartblocks &&
          window.roamjs.extension.smartblocks.registerCommand(insertCmd);
        window.roamjs?.extension.smartblocks &&
          window.roamjs.extension.smartblocks.registerCommand(deleteCmd);
      });
    }

    if (inlineNotesOption) addAutocompleteObserver();

    extensionAPI.ui.slashCommand.addCommand({
      label: "Insert footnote",
      callback: (args) => {
        noteInline = null;
        const uid = args["block-uid"];
        // args.indexes = [slashStart, slashEnd] in the block string.
        // indexes[0] is where "/" was typed — the exact insertion point.
        const slashPos = (args.indexes?.[0] ?? 1) - 1;
        currentPos = new position();
        currentPos.s = slashPos;
        currentPos.e = slashPos;
        // Defer so Roam finishes removing the "/Insert footnote" slash text
        // before we read the block content and insert the alias.
        setTimeout(() => insertOrRemoveFootnote(uid), 100);
      },
    });

    window.roamAlphaAPI.ui.blockRefContextMenu.addCommand({
      label: "Delete footnote",
      "display-conditional": (args) => {
        // Show only if the referenced block is a child of the footnotes header
        // (i.e. it's an actual footnote, not an arbitrary block reference).
        const refUid = args["ref-uid"];
        const blockUid = args["block-uid"];
        const pageTitle = getPageTitleByBlockUid(blockUid);
        const headerUid = getBlockUidOnPageByExactText(
          footnotesTag,
          normalizePageTitle(pageTitle),
        );
        if (!headerUid) return false;
        const children = getTreeByUid(headerUid)?.[0]?.children;
        return children?.some((child) => child.uid === refUid) ?? false;
      },
      callback: (args) => {
        const blockUid = args["block-uid"];
        const content = getBlockContent(blockUid);
        // indexes = [outerStart, outerEnd] of the full alias in the containing block
        const aliasStart = args.indexes?.[0] ?? 0;
        currentPos = new position();
        currentPos.s = aliasStart;
        currentPos.e = aliasStart;
        // Expand selection to span the alias so insertOrRemoveFootnote removes it
        const aliasPattern = new RegExp(anyAliasPattern.source, "g");
        let match;
        while ((match = aliasPattern.exec(content)) !== null) {
          if (
            match.index <= aliasStart &&
            aliasStart <= match.index + match[0].length
          ) {
            currentPos.s = match.index;
            currentPos.e = match.index + match[0].length;
            break;
          }
        }
        insertOrRemoveFootnote(blockUid);
      },
    });

    window.roamAlphaAPI.ui.msContextMenu.addCommand({
      label: "Delete footnotes",
      "display-conditional": (args) => {
        return (
          args.blocks?.some((block) => {
            const content = getBlockContent(block["block-uid"]);
            return anyAliasPattern.test(content);
          }) ?? false
        );
      },
      callback: (args) => {
        const uid = args.blocks?.[0]?.["block-uid"];
        if (!uid) return;
        const selectedUids = new Set(args.blocks.map((b) => b["block-uid"]));
        removeFootNotesInSelection(uid, selectedUids);
      },
    });

    console.log("Footnotes loaded.");
  },
  onunload: () => {
    disconnectAutocompleteObserver();
    document.removeEventListener("keydown", onKeyDown);
    window.roamAlphaAPI.ui.blockRefContextMenu.removeCommand({
      label: "Delete footnote",
    });
    window.roamAlphaAPI.ui.msContextMenu.removeCommand({
      label: "Delete footnotes",
    });
    console.log("Footnotes unloaded");
  },
};
