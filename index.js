var gd = module.exports = Object.create(require('node-gd')),
    fs = require('fs'),
    util = require('util'),
    buffertools = require('buffertools'),
    exifParser = require('exif-parser'),
    _ = require('underscore')


var formats = {
    jpeg: {
        ext: 'jpg',
        signature: new Buffer([0xff, 0xd8, 0xff]),
        createFromPtr: gd.createFromJpegPtr,
        ptr: namedArgs(gd.Image.prototype.jpegPtr, 'jpegquality', -1),
        save: namedArgs(gd.Image.prototype.saveJpeg, 'jpegquality', -1),
    },
    png: {
        ext: 'png',
        signature: new Buffer([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        createFromPtr: gd.createFromPngPtr,
        ptr: namedArgs(gd.Image.prototype.pngPtr, 'pnglevel', -1),
        save: namedArgs(gd.Image.prototype.savePng, 'pnglevel', -1),
    },
    gif: {
        ext: 'gif',
        signature: new Buffer('GIF'),
        createFromPtr: gd.createFromGifPtr,
        ptr: gd.Image.prototype.gifPtr,
        save: namedArgs(gd.Image.prototype.saveGif),
    },
}

var openDefaults = {
    autorotate: true,
}

gd.open = optionallyAsync(function open(source, options) {
    options = _(options || {}).defaults(openDefaults)

    var imageData = loadImageData(source)
    if (!imageData.length) throw GdError(gd.NODATA)

    var format = detectFormat(imageData)
    var image = formats[format].createFromPtr.call(gd, imageData)
    if (!image) throw GdError(gd.BADIMAGE)
    image.format = format

    //TODO: process options.autorotate

    return image
}, GdError, gd)

function loadImageData(source) {
    if (source instanceof Buffer) return source

    if (typeof source === 'string') {
        try {
            return fs.readFileSync(source)
        } catch (e) {
            if (e.code === 'ENOENT') throw GdError(gd.DOESNOTEXIST)
            throw GdError(gd.BADFILE, e.message)
        }
    }
    throw new Error('BAD SOURCE TYPE')
}

function detectFormat(buffer) {
    var name, signature
    for (name in formats) {
        signature = formats[name].signature
        if (buffer.slice(0, signature.length).equals(signature))
            return name
    }
    throw GdError(gd.BADFORMAT)
}

gd.getFormatPtr = function (buffer) {
    var name, signature
    for (name in formats) {
        signature = formats[name].signature
        if (buffer.slice(0, signature.length).equals(signature))
            return name
    }
    throw gdError('unknown_format', 'Unknown image format')
}

gd.createFromPtr = function (buffer, options, callback) {
    var format, image
    // TODO: take out options/callback logic and default values
    if (typeof options === 'function') {
        callback = options
        options = {}
    }
    _(options).defaults({
        autorotate: true,
    })
    try {
        format = gd.getFormatPtr(buffer)
    } catch (err) {
        return callback(err)
    }
    image = formats[format].createFromPtr.call(this, buffer)
    if (!image) return callback(gdError('open', 'Failed to create image from buffer'))
    image.format = format

    if (options.autorotate && format === 'jpeg') {
        try {
            var exif = exifParser.create(buffer).parse()
        } catch (err) {
            return callback(null, image)
        }
        return autorotateImage(image, exif, callback)
    }
    return callback(null, image)
}

gd.createFrom = function (filename, options, callback) {
    if (typeof options === 'function') {
        callback = options
        options = {}
    }
    fs.readFile(filename, function(e, data) {
        if (e) return callback(gdError('read', e))
        gd.createFromPtr(data, options, callback)
    })
}

gd.Image.prototype.save = function (filename, options, callback) {
    if (typeof options === 'function') {
        callback = options
        options = {}
    }
    try {
        var format = formats[this.targetFormat(options)]
    } catch (err) {
        return callback(err)
    }
    return format.save.call(this, filename.replace('{ext}', format.ext), options, callback)
}

gd.Image.prototype.ptr = function (options) {
    var format, data
    options = options || {}
    format = this.targetFormat(options)
    data = formats[format].ptr.call(this, options)
    return new Buffer(data, 'binary')
}

gd.Image.prototype.targetFormat = function (options) {
    var format
    options = options || {}
    format = options.format || this.format || options.defaultFormat
    if (!format) throw gdError('format_required', 'Image format required')
    format = format.toLowerCase()
    if (!(format in formats)) throw gdError('unknown_format', 'Unknown format ' + format)
    return format
}

gd.Image.prototype.resized = function (options) {
    var rw, rh, rr,
        sw, sh, sr, sx, sy,
        tw, th, tr,
        target

    if (rw > this.width && rh > this.height)
        return this

    rw = options.width || +Infinity
    rh = options.height || +Infinity
    rr = rw / rh
    sr = this.width / this.height

    if (options['method'] === 'crop') {
        tw = Math.min(rw, this.width)
        th = Math.min(rh, this.height)
        tr = tw / th
        if (sr >= rr) {
            sh = this.height
            sw = Math.floor(sh * tr)
            sy = 0
            sx = Math.floor((this.width - sw) / 2)
        } else {
            sw = this.width
            sh = Math.floor(sw / tr)
            sx = 0
            sy = Math.floor((this.height - sh) / 2)
        }
    } else {
        sx = sy = 0
        sw = this.width
        sh = this.height
        if (sr >= rr) {
            tw = Math.min(rw, this.width)
            th = Math.floor(tw / sr)
        } else {
            th = Math.min(rh, this.height)
            tw = Math.floor(th * sr)
        }
    }

    target = gd.createTrueColor(tw, th)
    target.format = this.targetFormat(options)

    target.saveAlpha(1)
    target.alphaBlending(target.format === 'jpeg' ? 1 : 0)
    this.copyResampled(target, 0, 0, sx, sy, tw, th, sw, sh)

    return target
}

gd.Image.prototype.resizedPtr = function (options) {
    return this.resized(options).ptr(options)
}


gd.colorBrightness = function (color) {
    if ((color & 0x7F000000) >> 24) return -1; // transparent color, won't count it at all
    var r = (color & 0xFF0000) >> 16,
        g = (color & 0x00FF00) >> 8,
        b = (color & 0x000FFF)
    return r * 0.299 + g * 0.587 + b * 0.114
}

gd.Image.prototype.rectBrightness = function (rect) {
    rect = rect || {x1: 0, y1: 0, x2: this.width, y2: this.height}
    var x, y, b,
        brightness = 0,
        opaque_pixels = (rect.x2 - rect.x1) * (rect.y2 - rect.y1)
    for (x = rect.x1; x < rect.x2; x++)
        for (y = rect.y1; y < rect.y2; y++) {
            b = gd.colorBrightness(this.getPixel(x, y))
            if (b === -1) opaque_pixels--
            else brightness += b
        }
    return brightness / opaque_pixels
}

gd.Image.prototype.watermarkRect = function (wm, pos) {
    var wmx = (this.width - wm.width) * pos.x;
    var wmy = (this.height - wm.height) * pos.y;
    return {x1: wmx, y1: wmy, x2: wmx + wm.width, y2: wmy + wm.height};
}

gd.Image.prototype.watermark = function (wm, pos) {
    var wmBrightness, posBrightnessDelta, x, y
    if (pos instanceof Array) {
        wmBrightness = wm.rectBrightness()
        posBrightnessDelta = pos.map(function (p) {
            return Math.abs(this.rectBrightness(this.watermarkRect(wm, p)) - wmBrightness)
        }, this)
        pos = pos[posBrightnessDelta.indexOf(Math.max.apply(Math,posBrightnessDelta))]
    }
    x = Math.round((this.width - wm.width) * pos.x)
    y = Math.round((this.height - wm.height) * pos.y)
    wm.copy(this, x, y, 0, 0, wm.width, wm.height)
    return this
}

var errorsDefinition = [
    ['DOESNOTEXIST',    'File does not exist.'],
    ['NODATA',          'Empty source file or buffer.'],
    ['BADFILE',         'Open error.'],
    ['BADFORMAT',       'Unsupported image format (or not an image at all).'],
    ['BADIMAGE',        'Corrupted or incomplete image.'],
]

var errorMessages = _.object(
    errorsDefinition.map(function (error, index) {
        var code = index + 1,
            name = error[0],
            message = error[1]
        gd[name] = code
        return [code, name + ', ' + message]
    })
)

function GdError(code, message) {
    if (!(this instanceof GdError)) return new GdError(code, message)
    this.message = message || errorMessages[code]
    this.code = code
}
util.inherits(GdError, Error)

function gdError (error, message) {
    var e = new Error(message)
    e.error = error
    return e
}

function autorotateImage (image, exif, callback) {
    var orientations = {
            3: -180,
            6: -90,
            8: -270,
        },
        angle,
        rotated

    if ('Orientation' in exif.tags && exif.tags.Orientation in orientations) {
        angle = orientations[exif.tags.Orientation]
        rotated = gd.createTrueColor(angle % 180 ? image.height : image.width, angle % 180 ? image.width : image.height)
        image.copyRotated(rotated, rotated.width / 2, rotated.height / 2, 0, 0, image.width, image.height, angle)
        rotated.format = image.format
        return callback(null, rotated)
    }

    callback(null, image)
}

function namedArgs (fn) {
    var slice = Array.prototype.slice,
        pop = Array.prototype.pop,
        argSpec = chunk(slice.call(arguments, 1), 2)
    return function () {
        var callback = arguments[arguments.length - 1] instanceof Function ? pop.apply(arguments) : null,
            namedArgs = pop.apply(arguments),
            args = slice.call(arguments)
        args = args.concat(argSpec.map(function (s) {return namedArgs[ s[0] ] || s[1]}))
        if (callback) args.push(callback)
        return fn.apply(this, args)
    }
}

function optionallyAsync(fn, ErrorToCatch, context) {
    return function () {
        if (typeof arguments[arguments.length - 1] !== 'function') return fn.apply(context, arguments)
        var args = Array.prototype.slice.call(arguments),
            callback = args.pop()
        try {
            var result = fn.apply(context, arguments)
            return callback(null, result)
        } catch (e) {
            if (e instanceof ErrorToCatch) return callback(e)
            throw e
        }
    }
}

function chunk (arr, len) {
    var chunks = [],
        i = 0,
        n = arr.length
    while (i < n)
        chunks.push(arr.slice(i, i += len))
    return chunks
}
