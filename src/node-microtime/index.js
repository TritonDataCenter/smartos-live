var binding = require('bindings')('microtime.node')

exports.now = binding.now
exports.nowDouble = binding.nowDouble
exports.nowStruct = binding.nowStruct
