# IMGADM - Image Administration Tool

imgadm is a tool for managing images on a local compute node. It can import 
and destroy local images, present information about how they're being used, 
and you can query the dataset API (https://datasets.joyent.com) for more 
images, or to import them.

imgadm comes with a command line tool, but can also be used quite easily as a 
library by importing it into your node application.

This repository contains a bash autocompleter in the tools directory It also 
contains a "repair.sh" script for fixing up the "database" of manifests on a 
local compute node.

DNS is disabled in most Platform images, so this application uses the built-in
node dns resolver.
