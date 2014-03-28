/*
 * This is not a real module.  All it does when require()'d is spew the
 * location of v8+'s base directory.  This is used by the makefiles so
 * that consumers don't have to set $(V8PLUS) manually, and allows npm to
 * install v8plus anywhere in node_modules.
 */
console.log(__dirname);
