var uuid = require('libuuid');
var start = (new Date()).getTime();
var cnt = 1000000;
for(var i=0;i<cnt;i++) {
  var str = uuid.create();
}
var end = (new Date()).getTime();
console.log(cnt + " over " + (end-start)/1000.0 + " seconds");
console.log(cnt/(end/start) + "create/second");
