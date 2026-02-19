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

const supAliasRegex = /\#sup\^\^\[(\(\d+\))\]\(\(\([^\)]*\)\)\)\^\^/g;
const aliasRegex = /\[(\(\d+\))\]\(\(\([^\)]*\)\)\)/g;
// Matches either form (with or without #sup^^...^^) — use without /g for .test()
const anyAliasPattern =
  /(?:\#sup\^\^)?\[(\(\d+\))\]\(\(\([^\)]*\)\)\)(?:\^\^)?/;
// Same as anyAliasPattern but also captures the note UID as group 2
const anyAliasWithUidPattern =
  /(?:\#sup\^\^)?\[\(\d+\)\]\(\(\(([^\)]*)\)\)\)(?:\^\^)?/g;
const supArray = ["#sup^^", "^^"];

let footnotesTag;
let footNotesUid;
let nbInPage = 0;
let shift = 0;
let footNotesUidArray = [];
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
    this.content = content;
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
      let noteIndex = getNoteIndex(selection);
      if (noteIndex !== null) {
        await removeFootNote(uid, noteIndex);
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
        let noteIndex = getNoteIndex(match[0]);
        if (noteIndex !== null) {
          await removeFootNote(uid, noteIndex);
          return;
        }
      }
    }
    await insertFootNote(uid);
  }
}

async function initAndGetTree(uid) {
  nbInPage = 0;
  shift = 0;
  let pageTitle = getPageTitleByBlockUid(uid);
  footNotesUid = await getFootNotesHeaderUid(pageTitle);
  return getPageTreeFromAnyBlockUid(uid);
}

async function insertFootNote(uid) {
  let tree = await initAndGetTree(uid);
  await processNotesInTree(tree, uid, insertNoteInBlock);
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
    if (nbInBlock !== 0 && !removeAll) {
      if (triggerUid === null || removeAll) {
        await callback(tree[i].uid, content, notesNbArray, index, removeAll);
      } else if (shift !== 0 && tree[i].uid !== triggerUid) {
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
  if (noteInline !== null) {
    let beginAt = noteInline.beginAt - 2;
    let endAt = beginAt;
    if (!noteInline.keyboardTriggered) {
      endAt += noteInline.content.length + 4;
    }
    left = content.slice(0, beginAt);
    right = content.slice(endAt);
    selection = noteInline.content;
  } else {
    left = content.slice(0, currentPos.s);
    right = content.slice(currentPos.e);
    if (currentPos.hasSelection())
      selection = content.slice(currentPos.s, currentPos.e);
  }
  let nbLeft = getNotesNumberInBlock(left).length;
  let newNoteNb = nbLeft + nbInPage + 1;
  let nbRight = getNotesNumberInBlock(right).length;
  shift = 1;
  if (nbRight >= 1) right = renumberNotes(right, newNoteNb, nbRight);
  let noteUid = await createNewNote(newNoteNb, selection);
  await insertAliasInBlock(uid, left, right, newNoteNb, noteUid);
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

function getNotesNumberInBlock(content) {
  if (content.length === 0) return [];
  let regex = /\[\([0-9]*\)\]\(\(\(/g;
  let m = [...content.matchAll(regex)];
  return m;
}

function getNoteIndex(content) {
  let noteRegex = /\([0-9]*\)/g;
  let nbRegex = /\d+/g;
  let note = content.match(noteRegex);
  if (note !== null) return note[0].match(nbRegex);
  return null;
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

async function createNewNote(nb = 1, content) {
  let uid = window.roamAlphaAPI.util.generateUID();
  await window.roamAlphaAPI.createBlock({
    location: { "parent-uid": footNotesUid, order: nb - 1 },
    block: { uid: uid, string: content },
  });
  return uid;
}

async function removeFootNote(startUid, index) {
  let tree = await initAndGetTree(startUid);
  await processNotesInTree(tree, startUid, removeFootNoteFromBlock, index);
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
    let nb;
    if (noteIndex !== -1) nb = parseInt(noteIndex);
    else nb = nbInPage + 1;
    let index = content.indexOf("[(" + nb + ")]");
    if (content.slice(index - 6, index) === "#sup^^") {
      leftSup = 6;
      rightSup = 2;
    }
    let uidShift = index + nb.toString().length + 7;
    let noteUid = content.substr(uidShift, 9);
    let noteContent = getBlockContent(noteUid);
    let right = content.slice(uidShift + 12 + rightSup);
    let nbRightNotes = getNotesNumberInBlock(right).length;
    shift = -1;
    right = renumberNotes(right, nb - 1, nbRightNotes);
    if (noteContent.length !== 0 && !removeAll)
      noteContent = "(deleted note: " + noteContent + ")";
    if (replaceBySimpleNumber) noteContent = "(" + nb + ")";
    content = content.slice(0, index - leftSup) + noteContent + right;
    if (!replaceBySimpleNumber) await deleteBlock(noteUid);
  }
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
  await processNotesInTree(tree, null, reorderNotesInBlock);
  reorderFootNoteBlock(footNotesUid);
}

async function reorderNotesInBlock(uid, content, notes) {
  let toUpdate = false;
  for (let i = 0; i < notes.length; i++) {
    let noteNb = getNoteIndex(notes[i][0]);
    let neededNb = nbInPage + i + 1;
    let index = notes[i].index;
    let uidIndex = index + notes[i][0].length;
    let noteUid = content.slice(uidIndex, uidIndex + 9);
    if (parseInt(noteNb) !== neededNb) {
      toUpdate = true;
      console.log(
        "Note " + noteNb + " renumbered to " + neededNb + " in " + uid,
      );
      let fullNoteAlias = content.slice(index, uidIndex + 12);
      let newNoteAlias = fullNoteAlias.replace(
        "(" + noteNb + ")",
        "(" + neededNb + ")",
      );
      content = content.replace(fullNoteAlias, newNoteAlias);
      footNotesUidArray.splice(neededNb, 0, noteUid);
    } else footNotesUidArray.push(noteUid);
  }
  if (toUpdate)
    await window.roamAlphaAPI.updateBlock({
      block: {
        uid: uid,
        string: content,
      },
    });
  return toUpdate;
}

function reorderFootNoteBlock(uid) {
  let currentNotes = getTreeByUid(uid)?.[0]?.children;
  if (currentNotes) {
    for (let i = 0; i < currentNotes.length; i++) {
      if (footNotesUidArray.includes(currentNotes[i].uid) === false)
        footNotesUidArray.push(currentNotes[i].uid);
    }
  }
  window.roamAlphaAPI.data.block.reorderBlocks({
    location: { "parent-uid": uid },
    blocks: footNotesUidArray,
  });
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

function createFootnoteButton(text) {
  const footnote = document.createElement("div");
  footnote.className = "dont-unfocus-block create-footnote";
  footnote.style = "border-radius: 2px; padding: 6px; cursor: pointer;";
  footnote.title = text;

  const markup = `
        <div class="rm-autocomplete-result">
            <span>${text}</span>
        </div>
        <div class="bp3-text-overflow-ellipsis" style="color: rgb(129, 145, 157);">Create as footnote</div>
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
    const ac = document.getElementsByClassName("rm-autocomplete__results")[0];
    if (!ac) {
      removeAcKeyHandler();
      return;
    }
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

  let uid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
  noteInline = getInlineNote();
  if (noteInline.content.length === 0) return;

  let hasCreateNoteItem = blockAutocomplete.querySelector(".create-footnote");
  if (hasCreateNoteItem !== null) {
    if (hasCreateNoteItem.parentNode === blockAutocomplete) {
      blockAutocomplete.removeChild(hasCreateNoteItem);
    }
  }
  footnoteButton = blockAutocomplete.insertAdjacentElement(
    "afterbegin",
    createFootnoteButton(noteInline.content),
  );
  // Only install the capture-phase handler once (first time button appears)
  if (!hasCreateNoteItem) {
    installAcKeyHandler(uid);
  }
  footnoteButton.addEventListener(
    "click",
    function () {
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
