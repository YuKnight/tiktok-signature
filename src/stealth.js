// This script should be injected via page.addInitScript() before navigating to any page

export const stealthScripts = [];

// 1. Configuration options
stealthScripts.push(`
// Auto-detect platform and set appropriate values for consistency
const isLinux = navigator.platform.toLowerCase().includes('linux');
const isMac = navigator.platform.toLowerCase().includes('mac');
const isWindows = navigator.platform.toLowerCase().includes('win');

const opts = {
  webgl_vendor: isLinux ? "Google Inc. (Intel)" : (isMac ? "Intel Inc." : "Google Inc. (NVIDIA)"),
  webgl_renderer: isLinux ? "ANGLE (Intel, Mesa Intel(R) UHD Graphics, OpenGL 4.6)" : (isMac ? "Intel Iris OpenGL Engine" : "ANGLE (NVIDIA, NVIDIA GeForce, OpenGL 4.5)"),
  navigator_vendor: "Google Inc.",
  navigator_platform: null,
  navigator_user_agent: null,
  languages: ["en-US", "en"],
  runOnInsecureOrigins: null
};
`);

stealthScripts.push(`
const utils = {}

utils.stripProxyFromErrors = (handler = {}) => {
  const newHandler = {}
  const traps = Object.getOwnPropertyNames(handler)
  traps.forEach(trap => {
    newHandler[trap] = function() {
      try {
        return handler[trap].apply(this, arguments || [])
      } catch (err) {
        if (!err || !err.stack || !err.stack.includes('at ')) {
          throw err
        }

        const stripWithBlacklist = stack => {
          const blacklist = [
            'at Reflect.' + trap + ' ',
            'at Object.' + trap + ' ',
            'at Object.newHandler.<computed> [as ' + trap + '] '
          ]
          return (
            err.stack
              .split('\\n')
              .filter((line, index) => index !== 1)
              .filter(line => !blacklist.some(bl => line.trim().startsWith(bl)))
              .join('\\n')
          )
        }

        const stripWithAnchor = stack => {
          const stackArr = stack.split('\\n')
          const anchor = 'at Object.newHandler.<computed> [as ' + trap + '] '
          const anchorIndex = stackArr.findIndex(line =>
            line.trim().startsWith(anchor)
          )
          if (anchorIndex === -1) {
            return false
          }
          stackArr.splice(1, anchorIndex)
          return stackArr.join('\\n')
        }

        err.stack = stripWithAnchor(err.stack) || stripWithBlacklist(err.stack)

        throw err
      }
    }
  })
  return newHandler
}

utils.stripErrorWithAnchor = (err, anchor) => {
  const stackArr = err.stack.split('\\n')
  const anchorIndex = stackArr.findIndex(line => line.trim().startsWith(anchor))
  if (anchorIndex === -1) {
    return err
  }
  stackArr.splice(1, anchorIndex)
  err.stack = stackArr.join('\\n')
  return err
}

utils.replaceProperty = (obj, propName, descriptorOverrides = {}) => {
  return Object.defineProperty(obj, propName, {
    ...(Object.getOwnPropertyDescriptor(obj, propName) || {}),
    ...descriptorOverrides
  })
}

utils.preloadCache = () => {
  if (utils.cache) {
    return
  }
  utils.cache = {
    Reflect: {
      get: Reflect.get.bind(Reflect),
      apply: Reflect.apply.bind(Reflect)
    },
    nativeToStringStr: Function.toString + ''
  }
}

utils.makeNativeString = (name = '') => {
  utils.preloadCache()
  return utils.cache.nativeToStringStr.replace('toString', name || '')
}

utils.patchToString = (obj, str = '') => {
  utils.preloadCache()

  const toStringProxy = new Proxy(Function.prototype.toString, {
    apply: function(target, ctx) {
      if (ctx === Function.prototype.toString) {
        return utils.makeNativeString('toString')
      }
      if (ctx === obj) {
        return str || utils.makeNativeString(obj.name)
      }
      const hasSameProto = Object.getPrototypeOf(
        Function.prototype.toString
      ).isPrototypeOf(ctx.toString)
      if (!hasSameProto) {
        return ctx.toString()
      }
      return target.call(ctx)
    }
  })
  utils.replaceProperty(Function.prototype, 'toString', {
    value: toStringProxy
  })
}

utils.patchToStringNested = (obj = {}) => {
  return utils.execRecursively(obj, ['function'], utils.patchToString)
}

utils.redirectToString = (proxyObj, originalObj) => {
  utils.preloadCache()

  const toStringProxy = new Proxy(Function.prototype.toString, {
    apply: function(target, ctx) {
      if (ctx === Function.prototype.toString) {
        return utils.makeNativeString('toString')
      }

      if (ctx === proxyObj) {
        const fallback = () =>
          originalObj && originalObj.name
            ? utils.makeNativeString(originalObj.name)
            : utils.makeNativeString(proxyObj.name)

        return originalObj + '' || fallback()
      }

      const hasSameProto = Object.getPrototypeOf(
        Function.prototype.toString
      ).isPrototypeOf(ctx.toString)
      if (!hasSameProto) {
        return ctx.toString()
      }

      return target.call(ctx)
    }
  })
  utils.replaceProperty(Function.prototype, 'toString', {
    value: toStringProxy
  })
}

utils.replaceWithProxy = (obj, propName, handler) => {
  utils.preloadCache()
  const originalObj = obj[propName]
  const proxyObj = new Proxy(obj[propName], utils.stripProxyFromErrors(handler))

  utils.replaceProperty(obj, propName, { value: proxyObj })
  utils.redirectToString(proxyObj, originalObj)

  return true
}

utils.mockWithProxy = (obj, propName, pseudoTarget, handler) => {
  utils.preloadCache()
  const proxyObj = new Proxy(pseudoTarget, utils.stripProxyFromErrors(handler))

  utils.replaceProperty(obj, propName, { value: proxyObj })
  utils.patchToString(proxyObj)

  return true
}

utils.createProxy = (pseudoTarget, handler) => {
  utils.preloadCache()
  const proxyObj = new Proxy(pseudoTarget, utils.stripProxyFromErrors(handler))
  utils.patchToString(proxyObj)

  return proxyObj
}

utils.splitObjPath = objPath => ({
  objName: objPath
    .split('.')
    .slice(0, -1)
    .join('.'),
  propName: objPath.split('.').slice(-1)[0]
})

utils.replaceObjPathWithProxy = (objPath, handler) => {
  const { objName, propName } = utils.splitObjPath(objPath)
  const obj = eval(objName)
  return utils.replaceWithProxy(obj, propName, handler)
}

utils.execRecursively = (obj = {}, typeFilter = [], fn) => {
  function recurse(obj) {
    for (const key in obj) {
      if (obj[key] === undefined) {
        continue
      }
      if (obj[key] && typeof obj[key] === 'object') {
        recurse(obj[key])
      } else {
        if (obj[key] && typeFilter.includes(typeof obj[key])) {
          fn.call(this, obj[key])
        }
      }
    }
  }
  recurse(obj)
  return obj
}

utils.stringifyFns = (fnObj = { hello: () => 'world' }) => {
  function fromEntries(iterable) {
    return [...iterable].reduce((obj, [key, val]) => {
      obj[key] = val
      return obj
    }, {})
  }
  return (Object.fromEntries || fromEntries)(
    Object.entries(fnObj)
      .filter(([key, value]) => typeof value === 'function')
      .map(([key, value]) => [key, value.toString()])
  )
}

utils.materializeFns = (fnStrObj = { hello: "() => 'world'" }) => {
  return Object.fromEntries(
    Object.entries(fnStrObj).map(([key, value]) => {
      if (value.startsWith('function')) {
        return [key, eval('() => ' + value)()]
      } else {
        return [key, eval(value)]
      }
    })
  )
}
`);

stealthScripts.push(`
generateFunctionMocks = (
    proto,
    itemMainProp,
    dataArray
) => ({
    item: utils.createProxy(proto.item, {
        apply(target, ctx, args) {
            if (!args.length) {
                throw new TypeError(
                    \`Failed to execute 'item' on '\${
                        proto[Symbol.toStringTag]
                    }': 1 argument required, but only 0 present.\`
                )
            }
            const isInteger = args[0] && Number.isInteger(Number(args[0]))
            return (isInteger ? dataArray[Number(args[0])] : dataArray[0]) || null
        }
    }),
    namedItem: utils.createProxy(proto.namedItem, {
        apply(target, ctx, args) {
            if (!args.length) {
                throw new TypeError(
                    \`Failed to execute 'namedItem' on '\${
                        proto[Symbol.toStringTag]
                    }': 1 argument required, but only 0 present.\`
                )
            }
            return dataArray.find(mt => mt[itemMainProp] === args[0]) || null
        }
    }),
    refresh: proto.refresh
        ? utils.createProxy(proto.refresh, {
            apply(target, ctx, args) {
                return undefined
            }
        })
        : undefined
})

function generateMagicArray(
    dataArray = [],
    proto = MimeTypeArray.prototype,
    itemProto = MimeType.prototype,
    itemMainProp = 'type'
) {
    const defineProp = (obj, prop, value) =>
        Object.defineProperty(obj, prop, {
            value,
            writable: false,
            enumerable: false,
            configurable: false
        })

    const makeItem = data => {
        const item = {}
        for (const prop of Object.keys(data)) {
            if (prop.startsWith('__')) {
                continue
            }
            defineProp(item, prop, data[prop])
        }
        if (itemProto === Plugin.prototype) {
            defineProp(item, 'length', 1)
        }
        return Object.create(itemProto, Object.getOwnPropertyDescriptors(item))
    }

    const magicArray = []

    dataArray.forEach(data => {
        magicArray.push(makeItem(data))
    })

    magicArray.forEach(entry => {
        defineProp(magicArray, entry[itemMainProp], entry)
    })

    const magicArrayObj = Object.create(proto, {
        ...Object.getOwnPropertyDescriptors(magicArray),

        length: {
            value: magicArray.length,
            writable: false,
            enumerable: false,
            configurable: true
        }
    })

    const functionMocks = generateFunctionMocks(
        proto,
        itemMainProp,
        magicArray
    )

    return new Proxy(magicArrayObj, {
        get(target, key = '') {
            if (key === 'item') {
                return functionMocks.item
            }
            if (key === 'namedItem') {
                return functionMocks.namedItem
            }
            if (proto === PluginArray.prototype && key === 'refresh') {
                return functionMocks.refresh
            }
            return utils.cache.Reflect.get(...arguments)
        },
        ownKeys(target) {
            const keys = []
            const typeProps = magicArray.map(mt => mt[itemMainProp])
            typeProps.forEach((_, i) => keys.push(\`\${i}\`))
            typeProps.forEach(propName => keys.push(propName))
            return keys
        }
    })
}
`);

stealthScripts.push(`
if (!window.chrome) {
    Object.defineProperty(window, 'chrome', {
        writable: true,
        enumerable: true,
        configurable: false,
        value: {}
    })
}

if (!('app' in window.chrome)) {
    const makeError = {
        ErrorInInvocation: fn => {
            const err = new TypeError(\`Error in invocation of app.\${fn}()\`)
            return utils.stripErrorWithAnchor(
                err,
                \`at \${fn} (eval at <anonymous>\`
            )
        }
    }

    const APP_STATIC_DATA = JSON.parse(
        \`
{
  "isInstalled": false,
  "InstallState": {
    "DISABLED": "disabled",
    "INSTALLED": "installed",
    "NOT_INSTALLED": "not_installed"
  },
  "RunningState": {
    "CANNOT_RUN": "cannot_run",
    "READY_TO_RUN": "ready_to_run",
    "RUNNING": "running"
  }
}
        \`.trim()
    )

    window.chrome.app = {
        ...APP_STATIC_DATA,

        get isInstalled() {
            return false
        },

        getDetails: function getDetails() {
            if (arguments.length) {
                throw makeError.ErrorInInvocation(\`getDetails\`)
            }
            return null
        },
        getIsInstalled: function getDetails() {
            if (arguments.length) {
                throw makeError.ErrorInInvocation(\`getIsInstalled\`)
            }
            return false
        },
        runningState: function getDetails() {
            if (arguments.length) {
                throw makeError.ErrorInInvocation(\`runningState\`)
            }
            return 'cannot_run'
        }
    }
    utils.patchToStringNested(window.chrome.app)
}
`);

stealthScripts.push(`
if (!window.chrome) {
    Object.defineProperty(window, 'chrome', {
        writable: true,
        enumerable: true,
        configurable: false,
        value: {}
    })
}

if (!('csi' in window.chrome) && (window.performance || window.performance.timing)) {
    const {timing} = window.performance

    window.chrome.csi = function () {
        return {
            onloadT: timing.domContentLoadedEventEnd,
            startE: timing.navigationStart,
            pageT: Date.now() - timing.navigationStart,
            tran: 15
        }
    }
    utils.patchToString(window.chrome.csi)
}
`);

stealthScripts.push(`
const elementDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

Object.defineProperty(HTMLDivElement.prototype, 'offsetHeight', {
  ...elementDescriptor,
  get: function() {
    if (this.id === 'modernizr') {
        return 1;
    }
    return elementDescriptor.get.apply(this);
  },
});
`);

stealthScripts.push(`
if (!window.chrome) {
    Object.defineProperty(window, 'chrome', {
        writable: true,
        enumerable: true,
        configurable: false,
        value: {}
    })
}

if (!('loadTimes' in window.chrome)) {
    if (
        window.performance ||
        window.performance.timing ||
        window.PerformancePaintTiming
    ) {

        const {performance} = window

        const ntEntryFallback = {
            nextHopProtocol: 'h2',
            type: 'other'
        }

        const protocolInfo = {
            get connectionInfo() {
                const ntEntry =
                    performance.getEntriesByType('navigation')[0] || ntEntryFallback
                return ntEntry.nextHopProtocol
            },
            get npnNegotiatedProtocol() {
                const ntEntry =
                    performance.getEntriesByType('navigation')[0] || ntEntryFallback
                return ['h2', 'hq'].includes(ntEntry.nextHopProtocol)
                    ? ntEntry.nextHopProtocol
                    : 'unknown'
            },
            get navigationType() {
                const ntEntry =
                    performance.getEntriesByType('navigation')[0] || ntEntryFallback
                return ntEntry.type
            },
            get wasAlternateProtocolAvailable() {
                return false
            },
            get wasFetchedViaSpdy() {
                const ntEntry =
                    performance.getEntriesByType('navigation')[0] || ntEntryFallback
                return ['h2', 'hq'].includes(ntEntry.nextHopProtocol)
            },
            get wasNpnNegotiated() {
                const ntEntry =
                    performance.getEntriesByType('navigation')[0] || ntEntryFallback
                return ['h2', 'hq'].includes(ntEntry.nextHopProtocol)
            }
        }

        const {timing} = window.performance

        function toFixed(num, fixed) {
            var re = new RegExp('^-?\\\\d+(?:.\\\\d{0,' + (fixed || -1) + '})?')
            return num.toString().match(re)[0]
        }

        const timingInfo = {
            get firstPaintAfterLoadTime() {
                return 0
            },
            get requestTime() {
                return timing.navigationStart / 1000
            },
            get startLoadTime() {
                return timing.navigationStart / 1000
            },
            get commitLoadTime() {
                return timing.responseStart / 1000
            },
            get finishDocumentLoadTime() {
                return timing.domContentLoadedEventEnd / 1000
            },
            get finishLoadTime() {
                return timing.loadEventEnd / 1000
            },
            get firstPaintTime() {
                const fpEntry = performance.getEntriesByType('paint')[0] || {
                    startTime: timing.loadEventEnd / 1000
                }
                return toFixed(
                    (fpEntry.startTime + performance.timeOrigin) / 1000,
                    3
                )
            }
        }

        window.chrome.loadTimes = function () {
            return {
                ...protocolInfo,
                ...timingInfo
            }
        }
        utils.patchToString(window.chrome.loadTimes)
    }
}
`);

stealthScripts.push(`
const STATIC_DATA = {
    "OnInstalledReason": {
        "CHROME_UPDATE": "chrome_update",
        "INSTALL": "install",
        "SHARED_MODULE_UPDATE": "shared_module_update",
        "UPDATE": "update"
    },
    "OnRestartRequiredReason": {
        "APP_UPDATE": "app_update",
        "OS_UPDATE": "os_update",
        "PERIODIC": "periodic"
    },
    "PlatformArch": {
        "ARM": "arm",
        "ARM64": "arm64",
        "MIPS": "mips",
        "MIPS64": "mips64",
        "X86_32": "x86-32",
        "X86_64": "x86-64"
    },
    "PlatformNaclArch": {
        "ARM": "arm",
        "MIPS": "mips",
        "MIPS64": "mips64",
        "X86_32": "x86-32",
        "X86_64": "x86-64"
    },
    "PlatformOs": {
        "ANDROID": "android",
        "CROS": "cros",
        "LINUX": "linux",
        "MAC": "mac",
        "OPENBSD": "openbsd",
        "WIN": "win"
    },
    "RequestUpdateCheckStatus": {
        "NO_UPDATE": "no_update",
        "THROTTLED": "throttled",
        "UPDATE_AVAILABLE": "update_available"
    }
}

if (!window.chrome) {
    Object.defineProperty(window, 'chrome', {
        writable: true,
        enumerable: true,
        configurable: false,
        value: {}
    })
}

const existsAlready = 'runtime' in window.chrome
const isNotSecure = !window.location.protocol.startsWith('https')
if (!(existsAlready || (isNotSecure && !opts.runOnInsecureOrigins))) {
    window.chrome.runtime = {
        ...STATIC_DATA,
        get id() {
            return undefined
        },
        connect: null,
        sendMessage: null
    }

    const makeCustomRuntimeErrors = (preamble, method, extensionId) => ({
        NoMatchingSignature: new TypeError(
            preamble + \`No matching signature.\`
        ),
        MustSpecifyExtensionID: new TypeError(
            preamble +
            \`\${method} called from a webpage must specify an Extension ID (string) for its first argument.\`
        ),
        InvalidExtensionID: new TypeError(
            preamble + \`Invalid extension id: '\${extensionId}'\`
        )
    })

    const isValidExtensionID = str =>
        str.length === 32 && str.toLowerCase().match(/^[a-p]+$/)

    const sendMessageHandler = {
        apply: function (target, ctx, args) {
            const [extensionId, options, responseCallback] = args || []

            const errorPreamble = \`Error in invocation of runtime.sendMessage(optional string extensionId, any message, optional object options, optional function responseCallback): \`
            const Errors = makeCustomRuntimeErrors(
                errorPreamble,
                \`chrome.runtime.sendMessage()\`,
                extensionId
            )

            const noArguments = args.length === 0
            const tooManyArguments = args.length > 4
            const incorrectOptions = options && typeof options !== 'object'
            const incorrectResponseCallback =
                responseCallback && typeof responseCallback !== 'function'
            if (
                noArguments ||
                tooManyArguments ||
                incorrectOptions ||
                incorrectResponseCallback
            ) {
                throw Errors.NoMatchingSignature
            }

            if (args.length < 2) {
                throw Errors.MustSpecifyExtensionID
            }

            if (typeof extensionId !== 'string') {
                throw Errors.NoMatchingSignature
            }

            if (!isValidExtensionID(extensionId)) {
                throw Errors.InvalidExtensionID
            }

            return undefined
        }
    }
    utils.mockWithProxy(
        window.chrome.runtime,
        'sendMessage',
        function sendMessage() {
        },
        sendMessageHandler
    )

    const connectHandler = {
        apply: function (target, ctx, args) {
            const [extensionId, connectInfo] = args || []

            const errorPreamble = \`Error in invocation of runtime.connect(optional string extensionId, optional object connectInfo): \`
            const Errors = makeCustomRuntimeErrors(
                errorPreamble,
                \`chrome.runtime.connect()\`,
                extensionId
            )

            const noArguments = args.length === 0
            const emptyStringArgument = args.length === 1 && extensionId === ''
            if (noArguments || emptyStringArgument) {
                throw Errors.MustSpecifyExtensionID
            }

            const tooManyArguments = args.length > 2
            const incorrectConnectInfoType =
                connectInfo && typeof connectInfo !== 'object'

            if (tooManyArguments || incorrectConnectInfoType) {
                throw Errors.NoMatchingSignature
            }

            const extensionIdIsString = typeof extensionId === 'string'
            if (extensionIdIsString && extensionId === '') {
                throw Errors.MustSpecifyExtensionID
            }
            if (extensionIdIsString && !isValidExtensionID(extensionId)) {
                throw Errors.InvalidExtensionID
            }

            const validateConnectInfo = ci => {
                if (args.length > 1) {
                    throw Errors.NoMatchingSignature
                }
                if (Object.keys(ci).length === 0) {
                    throw Errors.MustSpecifyExtensionID
                }
                Object.entries(ci).forEach(([k, v]) => {
                    const isExpected = ['name', 'includeTlsChannelId'].includes(k)
                    if (!isExpected) {
                        throw new TypeError(
                            errorPreamble + \`Unexpected property: '\${k}'.\`
                        )
                    }
                    const MismatchError = (propName, expected, found) =>
                        TypeError(
                            errorPreamble +
                            \`Error at property '\${propName}': Invalid type: expected \${expected}, found \${found}.\`
                        )
                    if (k === 'name' && typeof v !== 'string') {
                        throw MismatchError(k, 'string', typeof v)
                    }
                    if (k === 'includeTlsChannelId' && typeof v !== 'boolean') {
                        throw MismatchError(k, 'boolean', typeof v)
                    }
                })
            }
            if (typeof extensionId === 'object') {
                validateConnectInfo(extensionId)
                throw Errors.MustSpecifyExtensionID
            }

            return utils.patchToStringNested(makeConnectResponse())
        }
    }
    utils.mockWithProxy(
        window.chrome.runtime,
        'connect',
        function connect() {
        },
        connectHandler
    )

    function makeConnectResponse() {
        const onSomething = () => ({
            addListener: function addListener() {
            },
            dispatch: function dispatch() {
            },
            hasListener: function hasListener() {
            },
            hasListeners: function hasListeners() {
                return false
            },
            removeListener: function removeListener() {
            }
        })

        const response = {
            name: '',
            sender: undefined,
            disconnect: function disconnect() {
            },
            onDisconnect: onSomething(),
            onMessage: onSomething(),
            postMessage: function postMessage() {
                if (!arguments.length) {
                    throw new TypeError(\`Insufficient number of arguments.\`)
                }
                throw new Error(\`Attempting to use a disconnected port object\`)
            }
        }
        return response
    }
}
`);

stealthScripts.push(`
try {
    const addContentWindowProxy = iframe => {
        const contentWindowProxy = {
            get(target, key) {
                if (key === 'self') {
                    return this
                }
                if (key === 'frameElement') {
                    return iframe
                }
                return Reflect.get(target, key)
            }
        }

        if (!iframe.contentWindow) {
            const proxy = new Proxy(window, contentWindowProxy)
            Object.defineProperty(iframe, 'contentWindow', {
                get() {
                    return proxy
                },
                set(newValue) {
                    return newValue
                },
                enumerable: true,
                configurable: false
            })
        }
    }

    const handleIframeCreation = (target, thisArg, args) => {
        const iframe = target.apply(thisArg, args)

        const _iframe = iframe
        const _srcdoc = _iframe.srcdoc

        Object.defineProperty(iframe, 'srcdoc', {
            configurable: true,
            get: function () {
                return _iframe.srcdoc
            },
            set: function (newValue) {
                addContentWindowProxy(this)
                Object.defineProperty(iframe, 'srcdoc', {
                    configurable: false,
                    writable: false,
                    value: _srcdoc
                })
                _iframe.srcdoc = newValue
            }
        })
        return iframe
    }

    const addIframeCreationSniffer = () => {
        const createElementHandler = {
            get(target, key) {
                return Reflect.get(target, key)
            },
            apply: function (target, thisArg, args) {
                const isIframe =
                    args && args.length && \`\${args[0]}\`.toLowerCase() === 'iframe'
                if (!isIframe) {
                    return target.apply(thisArg, args)
                } else {
                    return handleIframeCreation(target, thisArg, args)
                }
            }
        }
        utils.replaceWithProxy(
            document,
            'createElement',
            createElementHandler
          )
    }

    addIframeCreationSniffer()
} catch (err) {
}
`);

stealthScripts.push(`
const parseInput = arg => {
    const [mime, codecStr] = arg.trim().split(';')
    let codecs = []
    if (codecStr && codecStr.includes('codecs="')) {
        codecs = codecStr
            .trim()
            .replace(\`codecs="\`, '')
            .replace(\`"\`, '')
            .trim()
            .split(',')
            .filter(x => !!x)
            .map(x => x.trim())
    }
    return {
        mime,
        codecStr,
        codecs
    }
}

const canPlayType = {
    apply: function (target, ctx, args) {
        if (!args || !args.length) {
            return target.apply(ctx, args)
        }
        const {mime, codecs} = parseInput(args[0])
        if (mime === 'video/mp4') {
            if (codecs.includes('avc1.42E01E')) {
                return 'probably'
            }
        }
        if (mime === 'audio/x-m4a' && !codecs.length) {
            return 'maybe'
        }

        if (mime === 'audio/aac' && !codecs.length) {
            return 'probably'
        }
        return target.apply(ctx, args)
    }
}

utils.replaceWithProxy(
    HTMLMediaElement.prototype,
    'canPlayType',
    canPlayType
)
`);

stealthScripts.push(`
const handler = {
    apply: function (target, ctx, args) {
        const param = (args || [])[0]

        if (param && param.name && param.name === 'notifications') {
            const result = {state: Notification.permission}
            Object.setPrototypeOf(result, PermissionStatus.prototype)
            return Promise.resolve(result)
        }

        return utils.cache.Reflect.apply(...arguments)
    }
}

utils.replaceWithProxy(
    window.navigator.permissions.__proto__,
    'query',
    handler
)
`);

stealthScripts.push(`
const data = {
    "mimeTypes": [
        {
            "type": "application/pdf",
            "suffixes": "pdf",
            "description": "",
            "__pluginName": "Chrome PDF Viewer"
        },
        {
            "type": "application/x-google-chrome-pdf",
            "suffixes": "pdf",
            "description": "Portable Document Format",
            "__pluginName": "Chrome PDF Plugin"
        },
        {
            "type": "application/x-nacl",
            "suffixes": "",
            "description": "Native Client Executable",
            "__pluginName": "Native Client"
        },
        {
            "type": "application/x-pnacl",
            "suffixes": "",
            "description": "Portable Native Client Executable",
            "__pluginName": "Native Client"
        }
    ],
    "plugins": [
        {
            "name": "Chrome PDF Plugin",
            "filename": "internal-pdf-viewer",
            "description": "Portable Document Format",
            "__mimeTypes": ["application/x-google-chrome-pdf"]
        },
        {
            "name": "Chrome PDF Viewer",
            "filename": "mhjfbmdgcfjbbpaeojofohoefgiehjai",
            "description": "",
            "__mimeTypes": ["application/pdf"]
        },
        {
            "name": "Native Client",
            "filename": "internal-nacl-plugin",
            "description": "",
            "__mimeTypes": ["application/x-nacl", "application/x-pnacl"]
        }
    ]
}

const hasPlugins = 'plugins' in navigator && navigator.plugins.length
if (!(hasPlugins)) {

    const mimeTypes = generateMagicArray(
        data.mimeTypes,
        MimeTypeArray.prototype,
        MimeType.prototype,
        'type'
    )
    const plugins = generateMagicArray(
        data.plugins,
        PluginArray.prototype,
        Plugin.prototype,
        'name'
    )

    for (const pluginData of data.plugins) {
        pluginData.__mimeTypes.forEach((type, index) => {
            plugins[pluginData.name][index] = mimeTypes[type]
            plugins[type] = mimeTypes[type]
            Object.defineProperty(mimeTypes[type], 'enabledPlugin', {
                value: JSON.parse(JSON.stringify(plugins[pluginData.name])),
                writable: false,
                enumerable: false,
                configurable: false
            })
        })
    }

    const patchNavigator = (name, value) =>
        utils.replaceProperty(Object.getPrototypeOf(navigator), name, {
            get() {
                return value
            }
        })

    patchNavigator('mimeTypes', mimeTypes)
    patchNavigator('plugins', plugins)
}
`);

stealthScripts.push(`delete Object.getPrototypeOf(navigator).webdriver`);

stealthScripts.push(`
'use strict'

try {
    if (!!window.outerWidth && !!window.outerHeight) {
        const windowFrame = 85
        window.outerWidth = window.innerWidth
        window.outerHeight = window.innerHeight + windowFrame
    }
} catch (err) {
}
`);

stealthScripts.push(`
const getParameterProxyHandler = {
    apply: function (target, ctx, args) {
        const param = (args || [])[0]
        if (param === 37445) {
            return opts.webgl_vendor || 'Intel Inc.'
        }
        if (param === 37446) {
            return opts.webgl_renderer || 'Intel Iris OpenGL Engine'
        }
        return utils.cache.Reflect.apply(target, ctx, args)
    }
}

const addProxy = (obj, propName) => {
    utils.replaceWithProxy(obj, propName, getParameterProxyHandler)
}
addProxy(WebGLRenderingContext.prototype, 'getParameter')
addProxy(WebGL2RenderingContext.prototype, 'getParameter')
`);

// Combined single script for backwards compatibility
export const stealthScript = stealthScripts.join('\n\n');
