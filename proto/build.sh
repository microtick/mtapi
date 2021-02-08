#!/usr/bin/env bash

DESTDIR=./root

rm -rf $DESTDIR
mkdir $DESTDIR

while read -r line; do
  path=`eval echo $line`
  protos=$(find -L $path -name "*.proto" -printf "%P ")
  for f in $protos 
  do
    echo "copying: $f to $DESTDIR/$f"
    destdir=`dirname $DESTDIR/$f`
    mkdir -p $destdir && cp $path/$f $DESTDIR/$f
  done
done < ./paths

echo "// Automatically generated - do not edit!" > index.js
echo "// --------------------------------------" >> index.js
echo "const protobuf = require('protobufjs')" >> index.js
echo "const files = [" >> index.js
find root | grep \\.proto | awk '{print "  \"./" $0 "\","}' >> index.js
echo "]" >> index.js
cat << END >> index.js
const root = new protobuf.Root()
root.loadSync(files)
module.exports = {
  create: (path, obj) => {
    const lookup = root.lookupType(path)
    const msg = lookup.fromObject(obj)
    return lookup.encode(msg).finish()
  },
  decode: (path, buf, deep) => {
    const lookup = root.lookupType(path)
    // Weird having to do this - protobufjs overrides some defaults and what is returned doesn't
    // behave like a traditional object.  The toObject() function does not recursively decode Any types.
    // So, we do this... <shrug>
    const msg = lookup.decode(buf)
    if (deep) {
      return JSON.parse(JSON.stringify(msg))
    }
    return lookup.toObject(msg, { enums: String, bytes: String })
  }
}
END

