/* ============================================================
 *  設定檔 — 公開展示版（放在作品集 repo 用這一份，改名成 config.js）
 *
 *  MODE:'demo' 的意思是：所有資料只寫進訪客自己瀏覽器的 localStorage。
 *  這裡沒有、也不可以有任何權杖——這個 repo 是公開的。
 *  訪客怎麼玩都碰不到公司內部的真實資料。
 * ========================================================== */

window.CFG = {

  MODE: 'demo',

  BRAND: 'Ducky',

  /* 左上角回作品集的連結 */
  BACK_URL: '../index.html#tools',
  BACK_LABEL: 'Ducky Huang',

  /* 範例調查的固定代碼，讓「直接看範例」的連結不會變 */
  DEMO_CODE: 'DEMOxK7pQ2mR9vT4wY6zB1nC3jH5sL8d',

  /* 公司內部正式版的網址。
   * 留空 → demo 頁面不會出現這條連結（建議：內部網址私下給同事就好）。
   * 填了 → 任何看到這一頁的人都會看到這個網址，請自行斟酌。 */
  INTERNAL_URL: '',
  INTERNAL_LABEL: '公司同仁請用內部版本',

  TZ_LABEL: 'Asia/Taipei',
  TZ_OFFSET: '+08:00',
  DOMAIN: '',                   // demo 不限制 Email 網域，訪客才能隨便試
  ROOT: 'polls'
};
