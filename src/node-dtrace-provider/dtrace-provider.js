var DTraceProvider;

function DTraceProviderStub() {}
DTraceProviderStub.prototype.addProbe = function() {
    return {
        'fire': function() { }
    };
};
DTraceProviderStub.prototype.enable = function() {};
DTraceProviderStub.prototype.fire = function() {};

try {
    var binding = require('/usr/node/node_modules/DTraceProviderBindings.node');
    DTraceProvider = binding.DTraceProvider;
} catch (e) {
    console.log(e);
}

if (!DTraceProvider) {
    DTraceProvider = DTraceProviderStub;
}

exports.DTraceProvider = DTraceProvider;
exports.createDTraceProvider = function(name, module) {
    if (arguments.length == 2)
        return (new DTraceProvider(name, module));
    return (new DTraceProvider(name));
};
