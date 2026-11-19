# SmartOS built with Nix from this checkout: smartos-live as it is checked out (its tracked files, changes included),
# and illumos-joyent, illumos-extra, the local projects and the toolchain as nixpkgs-illumos pins them. The build is
# stamped from this checkout's commit.
#
#   tools/build_nix [OUTPUT-DIR]                 a platform and its USB image in one step (root, in a Nix build zone)
#   nix-build -A smartos-live.builderTools       the tools that make them
#
# nixpkgs-illumos (https://github.com/TritonDataCenter/nixpkgs-illumos) holds the recipes, at the commit
# nix/nixpkgs-illumos.json pins; a checkout of it can stand in: -I nixpkgs-illumos=PATH (or NIX_PATH), or
# --arg nixpkgsIllumos PATH. The platform's gitstatus.json names the commit the recipes are: the pin's, or the
# checkout's own.
let
  pin = builtins.fromJSON (builtins.readFile ./nix/nixpkgs-illumos.json);
  local = builtins.tryEval <nixpkgs-illumos>;
in
{
  nixpkgsIllumos ? null,
}:

let
  pinned = nixpkgsIllumos == null && !local.success;
  recipes =
    if nixpkgsIllumos != null then
      nixpkgsIllumos
    else if local.success then
      local.value
    else
      builtins.fetchTarball {
        url = "https://github.com/${pin.owner}/${pin.repo}/archive/${pin.rev}.tar.gz";
        inherit (pin) sha256;
      };
in
import (recipes + "/smartos.nix") (
  {
    smartosLiveCheckout = ./.;
  }
  // (
    if pinned then
      {
        nixpkgsIllumosPin = {
          inherit (pin) rev date;
          url = "https://github.com/${pin.owner}/${pin.repo}.git";
        };
      }
    else
      { }
  )
)
// {
  # where the recipes came from, for tools/build_nix
  nixpkgs-illumos = recipes;
}
