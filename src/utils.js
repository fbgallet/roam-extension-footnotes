export function getBlockContent(uid) {
  let result = window.roamAlphaAPI.pull("[:block/string]", [":block/uid", uid]);
  if (result) return result[":block/string"];
  else return "";
}

export function getTreeByUid(uid) {
  if (uid)
    return window.roamAlphaAPI.q(`[:find (pull ?page
                     [:block/uid :block/string :block/children :block/refs
                        {:block/children ...} ])
                      :where [?page :block/uid "${uid}"]  ]`)[0];
  else return null;
}

export function getPageTreeFromAnyBlockUid(uid) {
  return window.roamAlphaAPI.q(`[:find (pull ?page 
    [:block/page :block/string :block/uid :block/children :block/order
    {:block/page ...} {:block/children ...}		])
                    :where [?page :block/uid "${uid}"]  ]`)[0][0].page.children;
}

export async function getAnyBlockUidInCurrentPage() {
  let currentBlockUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
  if (currentBlockUid) return currentBlockUid;
  else {
    let uid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
    return getFirstChildUid(uid);
  }
}

function getFirstChildUid(uid) {
  let q = `[:find (pull ?c
                       [:block/uid :block/children {:block/children ...}])
                    :where [?c :block/uid "${uid}"]  ]`;
  return window.roamAlphaAPI.q(q)[0][0].children[0].uid;
}

export function getBlockUidOnPageByExactText(text, page) {
  let a = window.roamAlphaAPI.q(
    `[:find ?u :where [?b :block/page ?p] 
                      [?b :block/uid ?u] 
                      [?b :block/string "${text}"] 
                      [?p :node/title "${page}"]]`
  );
  if (a.length === 0) return null;
  else return a[0][0];
}
