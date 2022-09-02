export function getTreeByUid(uid) {
  if (uid)
    return window.roamAlphaAPI.q(`[:find (pull ?page
                     [:block/uid :block/string :block/children :block/open :block/refs
                        {:block/children ...} ])
                      :where [?page :block/uid "${uid}"]  ]`)[0][0];
  else return null;
}
