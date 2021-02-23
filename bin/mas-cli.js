#!/usr/bin/env node
var ejs = require('ejs')
var fs = require('fs')
var minimatch = require('minimatch')
var mkdirp = require('mkdirp')
var path = require('path')
var program = require('commander')
var readline = require('readline')
var sortedObject = require('sorted-object')
var util = require('util')

var MODE_0666 = parseInt('0666', 8)
var MODE_0755 = parseInt('0755', 8)
var TEMPLATE_DIR = path.join(__dirname, '..', 'templates')
var VERSION = require('../package').version

var _exit = process.exit

process.exit = exit

// CLI

function exit (code) {
    // flush output for Node.js Windows pipe bug
    // https://github.com/joyent/node/issues/6247 is just one bug example
    // https://github.com/visionmedia/mocha/issues/333 has a good discussion
    function done () {
        if (!(draining--)) _exit(code)
    }

    var draining = 0
    var streams = [process.stdout, process.stderr]

    exit.exited = true

    streams.forEach(function (stream) {
        // submit empty write request and wait for completion
        draining += 1
        stream.write('', done)
    })

    done()
}

around(program, 'optionMissingArgument', function (fn, args) {
    program.outputHelp()
    fn.apply(this, args)
    return { args: [], unknown: [] }
})


before(program, 'outputHelp', function () {
    // track if help was shown for unknown option
    this._helpShown = true
})

before(program, 'unknownOption', function () {
    // allow unknown options if help was shown, to prevent trailing error
    this._allowUnknownOption = this._helpShown

    // show help if not yet shown
    if (!this._helpShown) {
        program.outputHelp()
    }
})

program
    .name('mas')
    .version(VERSION, '    --version')
    .usage('[options] [dir]')
    // .option('-i, --interface', 'add interface support')
    .option('-f, --force', 'force on non-empty directory')
    .parse(process.argv)


if (!exit.exited) {
    main()
}

function renamedOption (originalName, newName) {
    return function (val) {
        warning(util.format("option `%s' has been renamed to `%s'", originalName, newName))
        return val
    }
}

/**
 * Check if the given directory `dir` is empty.
 *
 * @param {String} dir
 * @param {Function} fn
 */

function emptyDirectory (dir, fn) {
    fs.readdir(dir, function (err, files) {
        if (err && err.code !== 'ENOENT') throw err
        fn(!files || !files.length)
    })
}
/**
 * Make the given dir relative to base.
 *
 * @param {string} base
 * @param {string} dir
 */

function mkdir (base, dir) {
    var loc = path.join(base, dir)

    console.log('   \x1b[36mcreate\x1b[0m : ' + loc + path.sep)
    mkdirp.sync(loc, MODE_0755)
}


/**
 * echo str > file.
 *
 * @param {String} file
 * @param {String} str
 */

function write (file, str, mode) {
    fs.writeFileSync(file, str, { mode: mode || MODE_0666 })
    console.log('   \x1b[36mcreate\x1b[0m : ' + file)
}



/**
 * Install an around function; AOP.
 */

function around (obj, method, fn) {
    var old = obj[method]

    obj[method] = function () {
        var args = new Array(arguments.length)
        for (var i = 0; i < args.length; i++) args[i] = arguments[i]
        return fn.call(this, old, args)
    }
}

/**
 * Install a before function; AOP.
 */

function before (obj, method, fn) {
    var old = obj[method]

    obj[method] = function () {
        fn.call(this)
        old.apply(this, arguments)
    }
}

/**
 * Prompt for confirmation on STDOUT/STDIN
 */

function confirm (msg, callback) {
    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })

    rl.question(msg, function (input) {
        rl.close()
        callback(/^y|yes|ok|true$/i.test(input))
    })
}

/**
 * Copy file from template directory.
 */

function copyTemplate (from, to, type) {
    if(type&& type==='xml'){
        write(to, fs.readFileSync(path.join(TEMPLATE_DIR, from)))
    }else{
        write(to, fs.readFileSync(path.join(TEMPLATE_DIR, from), 'utf-8'))
    }

}

/**
 * Copy multiple files from template directory.
 */

function copyTemplateMulti (fromDir, toDir, nameGlob) {
    fs.readdirSync(path.join(TEMPLATE_DIR, fromDir))
        .filter(minimatch.filter(nameGlob, { matchBase: true }))
        .forEach(function (name) {
            copyTemplate(path.join(fromDir, name), path.join(toDir, name))
        })
}

function main () {
    // Path
    var destinationPath = program.args.shift() || '.'
    var projectName = createProjectName(path.resolve(destinationPath)) || 'hello-mas'
    // Generate mas project
    emptyDirectory(destinationPath, function (empty) {
        if (empty || program.force) {
            createProject(projectName, destinationPath)
        } else {
            confirm('当前不是空目录,是否继续创建? [y/n] ', function (ok) {
                if (ok) {
                    process.stdin.destroy()
                    createProject(projectName, destinationPath)
                } else {
                    console.error('aborting')
                    exit(1)
                }
            })
        }
    })
}

/**
 * Create an mas name from a directory path, fitting npm naming requirements.
 *
 * @param {String} pathName
 */
function createProjectName (pathName) {
    return path.basename(pathName)
        .replace(/[^A-Za-z0-9.-]+/g, '-')
        .replace(/^[-_.]+|-+$/g, '')
        .toLowerCase()
}

/**
 * Create application at the given directory.
 *
 * @param {string} name
 * @param {string} dir
 */

function createProject (name, dir) {
    // Package
    var pkg = {
        name: name,
        version: '1.0.0',
        private: true,
        scripts: {
            start: 'node mas.js'
        },
        dependencies: {
            'meap': '1.1.2',
            "ioredis": "^4.19.4",
            "node-expat": "^2.3.18",
            "node-uuid": "^1.4.8",
            "async": "^3.2.0"
        }
    }

    if (dir !== '.') {
        mkdir(dir, '.')
    }

    var service = loadTemplate('service.json');
    service.locals.servicename = name+'api';

     mkdir(dir, 'interface')
     mkdir(dir, `interface/${name}api`)
     mkdir(dir, `interface/${name}api/demo`)

    service.locals.interfacedir=__dirname+dir+'/interface'

    write(path.join(dir, 'service.json'), service.render())

    copyTemplate('mas.js', path.join(dir, 'mas.js'))
    copyTemplate('if.js', path.join(dir, `/interface/${name}api/demo/if.js`));
    copyTemplate('./js/interface.xml', path.join(dir, `/interface/${name}api/interface.xml`),'xml');
    copyTemplateMulti('js', dir + `/interface/${name}api`, '*.js')
    write(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
}




/**
 * Load template file.
 */

function loadTemplate (name) {
    var contents = fs.readFileSync(path.join(__dirname, '..', 'templates', (name + '.ejs')), 'utf-8')
    var locals = Object.create(null)

    function render () {
        return ejs.render(contents, locals, {
            escape: util.inspect
        })
    }

    return {
        locals: locals,
        render: render
    }
}
