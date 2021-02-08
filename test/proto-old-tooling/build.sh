#!/usr/bin/env bash

rm -rf js
mkdir js

while read -r line; do
  path=`eval echo $line`
  imports="-I $path $imports"
  protos="$protos $(find -L $path -name "*.proto" -printf "%P ")"
done < ./paths

echo $imports
echo $protos

protoc $imports --js_out=import_style=commonjs,binary:js $protos

echo "// Automatically generated - do not edit!" > index.js
echo "// --------------------------------------" >> index.js
find js | grep \.js | awk '{print "require(\"./" $0 "\")"}' >> index.js

