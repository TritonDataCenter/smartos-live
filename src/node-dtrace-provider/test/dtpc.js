var util = require('util');
var d = require('../dtrace-provider');

var dtp = d.createDTraceProvider("testlibusdt");
var p = dtp.addProbe("32probe", "char *", "char *", "char *", "char *", "char *", "char *", "char *", "char *",
                                "char *", "char *", "char *", "char *", "char *", "char *", "char *", "char *",
                                "char *", "char *", "char *", "char *", "char *", "char *", "char *", "char *",
                                "char *", "char *", "char *", "char *", "char *", "char *", "char *", "char *");
dtp.enable();

util.debug("run: sudo dtrace -n 'testlibusdt*:::32probe{ printf(\"%s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s\", copyinstr((user_addr_t)args[0]), copyinstr((user_addr_t)args[1]), copyinstr((user_addr_t)args[2]), copyinstr((user_addr_t)args[3]), copyinstr((user_addr_t)args[4]), copyinstr((user_addr_t)args[5]), copyinstr((user_addr_t)args[6]), copyinstr((user_addr_t)args[7]), copyinstr((user_addr_t)args[8]), copyinstr((user_addr_t)args[9]), copyinstr((user_addr_t)args[10]), copyinstr((user_addr_t)args[11]), copyinstr((user_addr_t)args[12]), copyinstr((user_addr_t)args[13]), copyinstr((user_addr_t)args[14]), copyinstr((user_addr_t)args[15]), copyinstr((user_addr_t)args[16]), copyinstr((user_addr_t)args[17]), copyinstr((user_addr_t)args[18]), copyinstr((user_addr_t)args[19]), copyinstr((user_addr_t)args[20]), copyinstr((user_addr_t)args[21]), copyinstr((user_addr_t)args[22]), copyinstr((user_addr_t)args[23]), copyinstr((user_addr_t)args[24]), copyinstr((user_addr_t)args[25]), copyinstr((user_addr_t)args[26]), copyinstr((user_addr_t)args[27]), copyinstr((user_addr_t)args[28]), copyinstr((user_addr_t)args[29]), copyinstr((user_addr_t)args[30]), copyinstr((user_addr_t)args[31])); }'")


var letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p',
               'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C', 'D', 'E', 'F'];

setTimeout(function() { 
    
    var args = [];
    letters.forEach(function(l) {
        args.push(l);
        dtp.fire("32probe", function(p) {
            return args;
        });
        p.fire(function(p) {
            return args;
        });
    });


}, 10000);
