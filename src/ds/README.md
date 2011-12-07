# DSADM - Dataset Administration Tool

dsadm is a tool for managing datasets on a local compute node. It can import 
and destroy local datasets, present information about how they're being used, 
and you can query the dataset API (https://datasets.joyent.com) for more 
datasets, or to import them.

dsadm comes with a command line tool, but can also be used quite easily as a 
library by importing it into your node application.

This repository contains a bash autocompleter in the tools directory It also 
contains a "repair.sh" script for fixing up the "database" of manifests on a 
local compute node.

DNS is disabled in most Platform images, so this application uses the built-in
node dns resolver.

This tool uses a different node zfs library
