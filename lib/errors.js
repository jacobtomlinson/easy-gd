var util = require('util')

var errorsDefinition = [
    ['UnknownSourceType',           'Unknown source type.'],
    ['EmptySource',                 'Empty source file or buffer.'],
    ['UnknownImageFormat',          'Unknown image format (or not an image at all).'],
    ['IncompleteImage',             'Corrupted or incomplete image.'],
    ['UnsupportedOrientation',      'Unsupported image Exif orientation tag value.'],
    ['DestinationFormatRequired',   'Destination image format required.'],
    ['UnknownDestinationType',      'Unknown destination type.'],
    ['FileOpen',                    'File open error.'],
    ['FileDoesNotExist',            'File does not exist.'],
    ['FileWrite',                   'File writing error.'],
    ['SynchronousStreamAccess',     'A stream cannot be read or written synchronously.'],
    ['OptionsRequired',             'An options argument should be passed in.'],
]

exports.Error = errorClass('Error', Error)
exports.classes = {'Error': Error}

errorsDefinition.forEach(function (definition) {
    var className = definition[0] + 'Error',
        defaultMessage = definition[1]
    exports[className] = errorClass(className, exports.Error, defaultMessage)
    exports.classes[className] = exports[className]
})

exports.routeError = function routeError(error, callback) {
    if (callback) return callback(error)
    throw error
}

function errorClass(name, parentClass, defaultMessage) {
    function CustomError(message) {
        if (!(this instanceof CustomError)) return new CustomError(message)
        this.name = name
        this.message = message || defaultMessage
        Error.captureStackTrace(this, CustomError)
    }
    util.inherits(CustomError, parentClass)
    return CustomError
}
