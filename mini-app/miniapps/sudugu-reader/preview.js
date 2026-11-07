/* 只有浏览器 ?demo=1 时启用；宿主的真 ant.python.call 从不读取这些样例。 */
window.readerFixtures = function (method, args) {
  const names = ['山中来信','渡口的灯','云海拾记','寻常人家','长街旧事','星河之外'];
  const books = names.map((name,index) => ({vod_id:String(100 + index),vod_name:name,
    vod_pic:'',vod_actor:'示例作者',vod_remarks:['玄幻 · 连载中','都市 · 已完结','仙侠 · 连载中'][index % 3]}));
  const categories = [{type_id:'all',type_name:'全部'},{type_id:'xuanhuan',type_name:'玄幻小说'},
    {type_id:'xianxia',type_name:'仙侠小说'},{type_id:'dushi',type_name:'都市小说'},
    {type_id:'lishi',type_name:'历史小说'},{type_id:'kehuan',type_name:'科幻小说'}];
  if (method === 'home') return {categories:categories,list:books};
  if (method === 'listing') return {list:books,page:args[1] || 1,pagecount:2};
  if (method === 'search') return {list:books.filter(book => book.vod_name.includes(args[0])),page:1,pagecount:1};
  if (method === 'detail') {
    const book = books.find(book => book.vod_id === args[0]) || books[0];
    return {...book,vod_content:'一封迟到了许多年的信，把远行的人重新带回山中。渡口还在，旧日的小路却有了新的名字。\n这是一段仅供预览的示例简介。',
      chapters:Array.from({length:120},(_,index) => ({title:'第' + (index + 1) + '章 ' + ['远行','山中来信','渡口','雨过天青'][index % 4],url:'https://www.suduguu.com/' + book.vod_id + '/' + (index + 1) + '.html'}))};
  }
  if (method === 'chapter') {
    const index = Number(args[0].match(/\/(\d+)\.html$/)[1]);
    return {title:'第' + index + '章 山中来信',url:args[0],content:Array.from({length:24},(_,i) => [
      '清晨的雾沿着溪流慢慢升起。林间的小路还带着昨夜的雨意，鞋底踩过石板，发出轻轻的响声。',
      '他在门前停下来，从行囊里取出那封信。信封的边角已经磨白，收信人的名字却依然清楚。',
      '远处有人推开了窗。熟悉的声音越过院墙，问他一路可还顺利。他笑了笑，忽然觉得这些年的旅途都在这一刻安静下来。',
      '此处文字为阅读器预览所写，用于展示字号、行距和阅读进度；正式运行时会显示速读谷的章节正文。'][i % 4]).join('\n\n')};
  }
  throw new Error('未知预览方法');
};
