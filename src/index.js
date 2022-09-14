import {
  getBlockContent,
  getAnyBlockUidInCurrentPage,
  getPageTreeFromAnyBlockUid,
  getBlockUidOnPageByExactText,
  getTreeByUid,
} from "./utils";
import getPageTitleByBlockUid from "roamjs-components/queries/getPageTitleByBlockUid";
import getPageUidByPageTitle from "roamjs-components/queries/getPageUidByPageTitle";

var footnotesTag;
var footNotesUid;
var nbInPage = 0;
var shift = 0;
var footNotesUidArray = [];
var isSup = true;
var supArray = ["#sup^^", "^^"];
var secondHotkey = "altKey";

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
    insertOrRemoveFootnote();
    e.preventDefault();
  }
}

function insertOrRemoveFootnote() {
  let startUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
  if (startUid != undefined) {
    if (currentPos.hasSelection()) {
      let content = getBlockContent(startUid);
      let selection = content.slice(currentPos.s - 2, currentPos.e + 2);
      let noteIndex = getNoteIndex(selection);
      if (noteIndex != null) {
        removeFootNote(startUid, noteIndex);
        return;
      }
    }
    insertFootNote(startUid);
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

function processNotesInTree(tree, triggerUid, callback, index = -1) {
  tree = tree.sort((a, b) => a.order - b.order);
  for (let i = 0; i < tree.length; i++) {
    let content = tree[i].string;
    let notesNbArray = getNotesNumberInBlock(content);
    let nbInBlock = notesNbArray.length;
    if (tree[i].uid === triggerUid) {
      content = callback(triggerUid, content, index);
      nbInBlock += shift;
    }
    if (nbInBlock != 0) {
      if (triggerUid === null) {
        callback(tree[i].uid, content, notesNbArray);
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
      processNotesInTree(subTree, triggerUid, callback, index);
    }
  }
}

function insertNoteInBlock(uid, content) {
  let left,
    right = "";
  left = content.slice(0, currentPos.s);
  right = content.slice(currentPos.e);
  let selection = "";
  if (currentPos.hasSelection())
    selection = content.slice(currentPos.s, currentPos.e);
  let nbLeft = getNotesNumberInBlock(left).length;
  let newNoteNb = nbLeft + nbInPage + 1;
  let nbRight = getNotesNumberInBlock(right).length;
  shift = 1;
  if (nbRight >= 1) right = renumberNotes(right, newNoteNb, nbRight);
  let noteUid = createNewNote(newNoteNb, selection);
  insertAliasInBlock(uid, left, right, newNoteNb, noteUid);
  openNoteInSidebar(noteUid);
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

function removeFootNoteFromBlock(uid, content, noteIndex) {
  let leftSup = 0;
  let rightSup = 0;
  if (isSup) {
    leftSup = 6;
    rightSup = 2;
  }
  let nb;
  if (noteIndex != -1) nb = parseInt(noteIndex);
  else nb = nbInPage + 1;
  let index = content.indexOf("[(" + nb + ")]");
  let uidShift = index + nb.toString().length + 7;
  let noteUid = content.substr(uidShift, 9);
  let noteContent = getBlockContent(noteUid);
  let right = content.slice(uidShift + 12 + rightSup);
  let nbRightNotes = getNotesNumberInBlock(right).length;
  shift = -1;
  right = renumberNotes(right, nb - 1, nbRightNotes);
  if (noteContent.length != 0)
    noteContent = "(deleted note: " + noteContent + ")";
  content = content.slice(0, index - leftSup) + noteContent + right;
  window.roamAlphaAPI.deleteBlock({ block: { uid: noteUid } });
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
  let uid = getBlockUidOnPageByExactText(footnotesTag, pageTitle);
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

/*function concatTabAsList(listArray) {
  let l = "";
  for (let i = 0; i < listArray.length; i++) {
    if (listArray[i].search(/\(\(/) == 0) {
      let refContent = getBlockContent(listArray[i].slice(2, -2));
      listArray[i] = refContent + " (Text from:" + listArray[i] + ")";
    }
    l += "%%" + listArray[i];
  }
  return l;
}*/

function getHotkeys(evt) {
  if (evt === "Ctrl + Alt + F") return "altKey";
  else return "shiftKey";
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
    document.addEventListener("keydown", onKeyDown);

    /*    const insertCmd = {
      text: "INSERTFOOTNOTE",
      help: "Insert automatically numbered footnote (requires the Footnotes extension)",
      handler: (context) => () => {
        currentPos = new position();
        currentPos.s = currentPos.s - 5;
        currentPos.e = currentPos.e - 5;
        insertOrRemoveFootnote();
        return "";
      },
    };
    const deleteCmd = {
      text: "DELETEFOOTNOTE",
      help: "Delete numbered footnote (requires the Footnotes extension)",
      handler: (context) => () => {
        currentPos = new position();
        currentPos.s = currentPos.s - 8;
        currentPos.e = currentPos.e - 4;
        insertOrRemoveFootnote();
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
    }*/

    console.log("Footnotes loaded.");
    return;
  },
  onunload: () => {
    document.removeEventListener("keydown", onKeyDown);
    window.roamAlphaAPI.ui.commandPalette.removeCommand({
      label: "Footnotes: Reorder footnotes on current page",
    });
    console.log("Footnotes unloaded");
  },
};
