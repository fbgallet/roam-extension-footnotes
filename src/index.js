import {
  getBlockContent,
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
var runners = {
  menuItems: [],
  observers: [],
};

const supAliasRegex = /\#sup\^\^\[(\([1-9]*\))\]\(\(\([^\)]*\)\)\)\^\^/g;
const aliasRegex = /\[(\([1-9]*\))\]\(\(\([^\)]*\)\)\)/g;

var footnotesTag;
var footNotesUid;
var nbInPage = 0;
var shift = 0;
var footNotesUidArray = [];
var isSup = true;
var secondHotkey = "altKey";
var footnoteButton = null;
var inlineNotesOption = true;
var footnoteButtonSelected = false;
var noteInline = null;
var replaceBySimpleNumber = false;

const supArray = ["#sup^^", "^^"];
const FOOTNOTE_CREATOR_ID = "footnote-creator";

var noteInlineObj = function (content, beginAt, keyboard = false) {
  this.content = content;
  this.beginAt = beginAt;
  this.keyboardTriggered = keyboard;
};

var position = function (elt = document.activeElement) {
  this.elt = elt;
  this.s = elt.selectionStart;
  this.e = elt.selectionEnd;

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
    if (this.s != this.e) return true;
    else return false;
  };
};
var currentPos; // = new position();

function onKeyDown(e) {
  if (
    (e.ctrlKey || e.metaKey) &&
    e[secondHotkey] &&
    e.key.toLowerCase() == "f"
  ) {
    currentPos = new position();
    let startUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
    noteInline = null;
    insertOrRemoveFootnote(startUid);
    e.preventDefault();
  }
}

function insertOrRemoveFootnote(uid) {
  if (uid != undefined) {
    if (currentPos.hasSelection()) {
      let content = getBlockContent(uid);
      let selection = content.slice(currentPos.s - 2, currentPos.e + 2);
      let noteIndex = getNoteIndex(selection);
      if (noteIndex != null) {
        removeFootNote(uid, noteIndex);
        return;
      }
    }
    insertFootNote(uid);
  }
}

function initAndGetTree(uid) {
  nbInPage = 0;
  shift = 0;
  let pageTitle = getPageTitleByBlockUid(uid);
  footNotesUid = getFootNotesHeaderUid(pageTitle);
  return getPageTreeFromAnyBlockUid(uid);
}

function insertFootNote(uid) {
  let tree = initAndGetTree(uid);
  processNotesInTree(tree, uid, insertNoteInBlock);
}

function processNotesInTree(
  tree,
  triggerUid,
  callback,
  index = -1,
  removeAll = false
) {
  tree = tree.sort((a, b) => a.order - b.order);
  for (let i = 0; i < tree.length; i++) {
    let content = tree[i].string;
    let notesNbArray = getNotesNumberInBlock(content);
    let nbInBlock = notesNbArray.length;
    if (tree[i].uid === triggerUid || removeAll) {
      content = callback(tree[i].uid, content, index, removeAll);
      nbInBlock += shift;
    }
    if (nbInBlock != 0 && !removeAll) {
      if (triggerUid === null || removeAll) {
        callback(tree[i].uid, content, notesNbArray, index, removeAll);
      } else if (shift != 0 && tree[i].uid != triggerUid) {
        content = renumberNotes(content, nbInPage, nbInBlock);
        window.roamAlphaAPI.updateBlock({
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
      processNotesInTree(subTree, triggerUid, callback, index, removeAll);
    }
  }
}

function insertNoteInBlock(uid, content) {
  let left,
    right = "";
  let selection = "";
  if (noteInline != null) {
    let beginAt = noteInline.beginAt - 2;
    let endAt = beginAt;
    if (!noteInline.keyboardTriggered) {
      //beginAt -= 2;
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
  let noteUid = createNewNote(newNoteNb, selection);
  insertAliasInBlock(uid, left, right, newNoteNb, noteUid);
  if (noteInline === null) openNoteInSidebar(noteUid);
  return content;
}

function insertAliasInBlock(uid, left, right, nb, noteUid) {
  if (isSup) {
    left += supArray[0];
    right = supArray[1] + right;
  }
  window.roamAlphaAPI.updateBlock({
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
  if (note != null) return note[0].match(nbRegex);
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
    //console.log(currentNb, newNb);
    return content.replace("[(" + currentNb + ")]", "[(" + newNb + ")]");
  }
  return content;
}

function createNewNote(nb = 1, content) {
  let uid = window.roamAlphaAPI.util.generateUID();
  window.roamAlphaAPI.createBlock({
    location: { "parent-uid": footNotesUid, order: nb - 1 },
    block: { uid: uid, string: content },
  });
  return uid;
}

function removeFootNote(startUid, index) {
  let tree = initAndGetTree(startUid);
  processNotesInTree(tree, startUid, removeFootNoteFromBlock, index);
}

function removeAllFootNotes(startUid) {
  let tree = initAndGetTree(startUid);
  processNotesInTree(tree, startUid, removeFootNoteFromBlock, -1, true);
}

function removeFootNoteFromBlock(uid, content, noteIndex, removeAll) {
  if (removeAll) {
    let replaceGroup = "";
    if (replaceBySimpleNumber) replaceGroup = "$1";
    content = content.replace(supAliasRegex, replaceGroup);
    content = content.replace(aliasRegex, replaceGroup);
  } else {
    let leftSup = 0;
    let rightSup = 0;
    let nb;
    if (noteIndex != -1) nb = parseInt(noteIndex);
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
    if (noteContent.length != 0 && !removeAll)
      noteContent = "(deleted note: " + noteContent + ")";
    if (replaceBySimpleNumber) noteContent = "(" + nb + ")";
    content = content.slice(0, index - leftSup) + noteContent + right;
    if (!replaceBySimpleNumber)
      window.roamAlphaAPI.deleteBlock({ block: { uid: noteUid } });
  }
  window.roamAlphaAPI.updateBlock({
    block: {
      uid: uid,
      string: content,
    },
  });
  return content;
}

function reorderFootNotes(uid) {
  let tree = initAndGetTree(uid);
  footNotesUidArray = [];
  processNotesInTree(tree, null, reorderNotesInBlock);
  reorderFootNoteBlock(footNotesUid);
}

function reorderNotesInBlock(uid, content, notes) {
  let toUpdate = false;
  for (let i = 0; i < notes.length; i++) {
    let noteNb = getNoteIndex(notes[i][0]);
    let neededNb = nbInPage + i + 1;
    let index = notes[i].index;
    let uidIndex = index + notes[i][0].length;
    let noteUid = content.slice(uidIndex, uidIndex + 9);
    if (parseInt(noteNb) != neededNb) {
      toUpdate = true;
      console.log(
        "Note " + noteNb + " renumbered to " + neededNb + " in " + uid
      );
      let fullNoteAlias = content.slice(index, uidIndex + 12);
      let newNoteAlias = fullNoteAlias.replace(
        "(" + noteNb + ")",
        "(" + neededNb + ")"
      );
      content = content.replace(fullNoteAlias, newNoteAlias);
      footNotesUidArray.splice(neededNb, 0, noteUid);
    } else footNotesUidArray.push(noteUid);
  }
  if (toUpdate)
    window.roamAlphaAPI.updateBlock({
      block: {
        uid: uid,
        string: content,
      },
    });
  return toUpdate;
}

function reorderFootNoteBlock(uid) {
  //console.log(footNotesUidArray);
  let currentNotes = getTreeByUid(uid)[0].children;
  if (currentNotes) {
    for (let i = 0; i < currentNotes.length; i++) {
      if (footNotesUidArray.includes(currentNotes[i].uid) === false)
        footNotesUidArray.push(currentNotes[i].uid);
    }
  }
  roamAlphaAPI.data.block.reorderBlocks({
    location: { "parent-uid": uid },
    blocks: footNotesUidArray,
  });
}

function openNoteInSidebar(uid) {
  window.roamAlphaAPI.ui.rightSidebar.addWindow({
    window: { type: "block", "block-uid": uid },
  });
}

function getFootNotesHeaderUid(pageTitle) {
  let uid = getBlockUidOnPageByExactText(
    footnotesTag,
    normalizePageTitle(pageTitle)
  );
  if (uid === null) return createFootNotesHeader(pageTitle);
  else return uid;
}

function createFootNotesHeader(pageTitle) {
  let pageUid = getPageUidByPageTitle(pageTitle);
  let uid = window.roamAlphaAPI.util.generateUID();
  window.roamAlphaAPI.createBlock({
    location: { "parent-uid": pageUid, order: "last" },
    block: { uid: uid, string: footnotesTag, "children-view-type": "numbered" },
  });
  return uid;
}
/*
function normalizeUid(uid) {
  if (uid.length == 13) {
    if (uid.includes("((") && uid.includes("))")) return uid.slice(2, -2);
  }
  if (uid.length == 9) return uid;
  return undefined;
}

function normalizeTitle(str) {
  return str.replace(/[/\\|\[\]$:~()^\{\}"'*_`]/g, "");
}*/

function getBlocksIncludingText(t) {
  return window.roamAlphaAPI.q(
    `[:find ?u ?contents 
    :where [?block :block/uid ?u]
      [?block :block/string ?contents]
      [(clojure.string/includes? ?contents  "${t}")]]`
  );
}

function getHotkeys(evt) {
  if (evt === "Ctrl + Alt + F") return "altKey";
  else return "shiftKey";
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
  let textArea = document.querySelectorAll("textarea")[0];
  let content = textArea.value;
  let cursorPos = textArea.selectionStart;
  let begin = content.slice(0, cursorPos).lastIndexOf("((") + 2;
  let noteStr = content.slice(begin, cursorPos);
  if (content.slice(begin - 2, begin) != "((") noteStr = "";
  return new noteInlineObj(noteStr, begin);
}

function keyboardSelect(e, uid, secondElt) {
  let noteContent = noteInline.content;
  if (document.getElementsByClassName("rm-autocomplete__results")) {
    // if 'Create as block below' option is selected
    if (secondElt.style.backgroundColor == "rgb(213, 218, 223)") {
      if (e.key === "ArrowUp" && footnoteButton.title == noteContent) {
        footnoteButton.setAttribute(
          "style",
          "border-radius: 2px; padding: 6px; cursor: pointer; background-color: rgb(213, 218, 223);"
        );
        footnoteButtonSelected = true;
      }
      document.addEventListener(
        "keydown",
        function (e) {
          keyboardSelect(e, uid, secondElt);
        },
        { once: true }
      );
    } else {
      if (e.key == "ArrowDown" || e.key == "ArrowUp") {
        if (footnoteButton.style.backgroundColor == "rgb(213, 218, 223)") {
          footnoteButton.setAttribute(
            "style",
            "border-radius: 2px; padding: 6px; cursor: pointer; background-color: inherit;"
          );
          footnoteButtonSelected = false;
        }
        document.addEventListener(
          "keydown",
          function (e) {
            keyboardSelect(e, uid, secondElt);
          },
          { once: true }
        );
      }
      if (footnoteButtonSelected && (e.key === "Enter" || e.key === "Tab")) {
        footnoteButtonSelected = false;
        noteInline.keyboardTriggered = true;
        insertFootNote(uid, noteInline);
      }
    }
  }
}

function addAutocompleteObserver() {
  if (
    document.getElementsByClassName("rm-autocomplete__results") &&
    !document.getElementById(FOOTNOTE_CREATOR_ID)
  ) {
    const blockAutocomplete = document.getElementsByClassName(
      "rm-autocomplete__results"
    )[0];
    if (blockAutocomplete) {
      let uid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
      noteInline = getInlineNote();
      if (noteInline.content.length > 0) {
        let hasCreateNoteItem =
          blockAutocomplete.querySelector(".create-footnote");
        if (hasCreateNoteItem === null) {
          footnoteButton = blockAutocomplete.insertAdjacentElement(
            "afterbegin",
            createFootnoteButton(noteInline.content)
          );
        } else {
          blockAutocomplete.removeChild(footnoteButton);

          footnoteButton = blockAutocomplete.insertAdjacentElement(
            "afterbegin",
            createFootnoteButton(noteInline.content)
          );
        }
        let addAsBlockElt = footnoteButton.nextElementSibling;
        document.addEventListener(
          "keydown",
          function (e) {
            keyboardSelect(e, uid, addAsBlockElt);
          },
          { once: true }
        );
        footnoteButton.addEventListener(
          "click",
          function () {
            insertFootNote(uid);
          },
          { once: true }
        );
      }
    }
  }
}

const panelConfig = {
  tabTitle: "Footnotes",
  settings: [
    {
      id: "footnotesHeader",
      name: "Footnote header",
      description: "Text inserted as the parent block of footnotes:",
      action: {
        type: "input",
        onChange: (evt) => {
          footnotesTag = evt.target.value;
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
      id: "inlineNotes",
      name: "Inline footnotes creation",
      description:
        "Add an option to block reference autocomplete box to create a footnote from the text entered between (( )):",
      action: {
        type: "switch",
        onChange: (evt) => {
          inlineNotesOption = !inlineNotesOption;
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
    {
      id: "hotkeys",
      name: "Hotkeys",
      description: "Hotkeys to insert/delete footnote",
      action: {
        type: "select",
        items: ["Ctrl + Alt + F", "Ctrl + Shift + F"],
        onChange: (evt) => {
          secondHotkey = getHotkeys(evt);
        },
      },
    },
  ],
};

export default {
  onload: ({ extensionAPI }) => {
    extensionAPI.settings.panel.create(panelConfig);
    if (extensionAPI.settings.get("footnotesHeader") == null)
      extensionAPI.settings.set("footnotesHeader", "#footnotes");
    footnotesTag = extensionAPI.settings.get("footnotesHeader");
    if (extensionAPI.settings.get("supNotes") == null)
      extensionAPI.settings.set("supNotes", true);
    isSup = extensionAPI.settings.get("supNotes");
    if (extensionAPI.settings.get("hotkeys") == null)
      extensionAPI.settings.set("hotkeys", "Ctrl + Alt + F");
    secondHotkey = getHotkeys(extensionAPI.settings.get("hotkeys"));
    if (extensionAPI.settings.get("inlineNotes") == null)
      extensionAPI.settings.set("inlineNotes", true);
    inlineNotesOption = extensionAPI.settings.get("inlineNotes");
    if (extensionAPI.settings.get("replaceByNumber") == null)
      extensionAPI.settings.set("replaceByNumber", false);
    replaceBySimpleNumber = extensionAPI.settings.get("replaceByNumber");
    /*   window.roamAlphaAPI.ui.commandPalette.addCommand({
      label: "Insert footnote",
      callback: () => {
        //        let position = document.activeElement.selectionStart;
        //        console.log(position);
        let startUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
        if (startUid) insertFootNote(startUid);
      },
    });*/
    window.roamAlphaAPI.ui.commandPalette.addCommand({
      label: "Footnotes: Reorder footnotes on current page",
      callback: async () => {
        let uid = await getAnyBlockUidInCurrentPage();
        reorderFootNotes(uid);
      },
    });
    window.roamAlphaAPI.ui.commandPalette.addCommand({
      label:
        "Footnotes: Warning, danger zone! Delete all footnotes on current page",
      callback: async () => {
        let uid = await getAnyBlockUidInCurrentPage();
        removeAllFootNotes(uid);
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

    const autocompleteObserver = createObserver(addAutocompleteObserver);
    // save observers globally so they can be disconnected later
    runners["observers"] = [autocompleteObserver];

    console.log("Footnotes loaded.");
    return;
  },
  onunload: () => {
    // loop through observers and disconnect
    for (let index = 0; index < runners["observers"].length; index++) {
      const element = runners["observers"][index];
      element.disconnect();
    }

    document.removeEventListener("keydown", onKeyDown);
    window.roamAlphaAPI.ui.commandPalette.removeCommand({
      label: "Footnotes: Reorder footnotes on current page",
    });
    console.log("Footnotes unloaded");
  },
};
