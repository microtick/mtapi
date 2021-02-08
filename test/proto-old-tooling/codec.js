// proto is a global defined by the google requires
/* global proto */

require("./index.js")

function getDescendentProp(obj, desc) {
  var arr = desc.split('.')
  while (arr.length && obj !== undefined) {
    obj = obj[arr.shift()]
  }
  return obj
}

// recursively iterate through object looking for typeUrl props
const decodeAny = obj => {
  if (obj.typeUrl !== undefined && obj.value !== undefined) {
    obj.any = decode(obj.typeUrl, obj.value)
  }
  if (obj instanceof Array) {
    for (var i = 0; i < obj.length; ++i) {
      decodeAny(obj[i])
    }
  } else if (typeof(obj) === 'object') {
    const keys = Object.keys(obj)
    for (var i=0; i<keys.length; i++) {
      const prop = keys[i]
      if (!(typeof(obj[prop]) === 'undefined')) {
        decodeAny(obj[prop])
      }
    }
  }
}

const decode = (path, base64) => {
  if (path.substr(0,1) !== "/") {
    throw new Error("Invalid lookup path: " + path)
  }
  const lookup = getDescendentProp(proto, path.substr(1))
  if (lookup !== undefined) {
    const obj = lookup.deserializeBinary(base64).toObject()
    decodeAny(obj)
    return obj
  } else {
    throw new Error("No lookup defined for: " + path)
  }
}

module.exports = {
  query: async (requestPath, responsePath, exec) => {
    if (requestPath.substr(0,1) === "/") {
      const lookup = getDescendentProp(proto, requestPath.substr(1))
      const req = new lookup()
      return decode(responsePath, await exec(req))
    }
    return null
  },
  create: requestPath => {
    if (requestPath.substr(0,1) === "/") {
      const lookup = getDescendentProp(proto, requestPath.substr(1))
      return new lookup()
    }
  },
  decode: decode
}

