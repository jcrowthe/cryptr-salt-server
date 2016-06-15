// =================== Packages ======================
var express             = require('express');
var app                 = express();
var ldap                = require('ldapjs');
var bodyParser          = require('body-parser');
var cookieParser        = require('cookie-parser');
var LocalStrategy       = require('passport-local').Strategy;
var passport            = require('passport');
var session             = require('express-session');
var bunyan              = require('bunyan');
var net                 = require('net');
var fs                  = require('fs');
var crypto              = require('crypto-js');
var child               = require('child_process');
var CronJob             = require('cron').CronJob;

var log = bunyan.createLogger({
	name: "cryptr-server",
	streams: [{
		level: 'info',
		stream: process.stdout
	}, {
		level: 'error',
		path: '/var/log/cryptr-server.log'
	}]
});
var keys = {};
var keysArray = [];
var keyTime = new Date();
// Base64 Decode string, from here: https://gist.github.com/ncerminara/11257943
var Base64={_keyStr:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",encode:function(e){var t="";var n,r,i,s,o,u,a;var f=0;e=Base64._utf8_encode(e);while(f<e.length){n=e.charCodeAt(f++);r=e.charCodeAt(f++);i=e.charCodeAt(f++);s=n>>2;o=(n&3)<<4|r>>4;u=(r&15)<<2|i>>6;a=i&63;if(isNaN(r)){u=a=64;}else if(isNaN(i)){a=64;}t=t+this._keyStr.charAt(s)+this._keyStr.charAt(o)+this._keyStr.charAt(u)+this._keyStr.charAt(a);}return t;},decode:function(e){var t="";var n,r,i;var s,o,u,a;var f=0;e=e.replace(/[^A-Za-z0-9+/=]/g,"");while(f<e.length){s=this._keyStr.indexOf(e.charAt(f++));o=this._keyStr.indexOf(e.charAt(f++));u=this._keyStr.indexOf(e.charAt(f++));a=this._keyStr.indexOf(e.charAt(f++));n=s<<2|o>>4;r=(o&15)<<4|u>>2;i=(u&3)<<6|a;t=t+String.fromCharCode(n);if(u!=64){t=t+String.fromCharCode(r);}if(a!=64){t=t+String.fromCharCode(i);}}t=Base64._utf8_decode(t);return t;},_utf8_encode:function(e){e=e.replace(/rn/g,"n");var t="";for(var n=0;n<e.length;n++){var r=e.charCodeAt(n);if(r<128){t+=String.fromCharCode(r);}else if(r>127&&r<2048){t+=String.fromCharCode(r>>6|192);t+=String.fromCharCode(r&63|128);}else{t+=String.fromCharCode(r>>12|224);t+=String.fromCharCode(r>>6&63|128);t+=String.fromCharCode(r&63|128);}}return t;},_utf8_decode:function(e){var t="";var n=0;var r=c1=c2=0;while(n<e.length){r=e.charCodeAt(n);if(r<128){t+=String.fromCharCode(r);n++;}else if(r>191&&r<224){c2=e.charCodeAt(n+1);t+=String.fromCharCode((r&31)<<6|c2&63);n+=2;}else{c2=e.charCodeAt(n+1);c3=e.charCodeAt(n+2);t+=String.fromCharCode((r&15)<<12|(c2&63)<<6|c3&63);n+=3;}}return t;}};




// =================== LDAP Configurations ======================
var ldapOU = 'CN=Cryptr-Auth';                        // The OU that a Cryptr user must be a member of to authenticate
var ldapURL = 'ldaps://example.com:636';              // LDAP server url. Including protocol and port
var ldapCN = 'CN=users,DC=ad,DC=example,DC=com';      // The CN/DC extension for user accounts
var ldapENTRY = 'OU=Other,DC=ad,DC=example,DC=com';   // The LDAP search entry point




// =================== Configure Python Socket ======================
// Configure unix socket for communication with salt master
var socketPath = '/var/run/cryptr/conn.sock';
var pysocket = net.createServer(function(conn) {
    var buff = '';
    conn.on('data', function(data) {
        buff += data;
    });
    conn.on('end', function(data) {
        keyTime = new Date();
        var temp = JSON.parse(buff.toString());
        for (var key in temp) {
            keys[key] = temp[key];
            keys[key].parsedname = crypto.SHA512(key).toString(crypto.enc.Hex);
        }
        keysArray = Object.keys(keys).map(function(k) {
            var temp = keys[k];
            temp.name = k;
            return temp;
        });
        buff = '';
        log.info('Keys updated');
    });
});
pysocket.listen(socketPath, function(err) {
    if (err) console.log('Listen error: ', err);
    log.info('Cryptr socket to python opened.');
});
// Check if error is 'socket already exists'. If so, connect to it.
pysocket.on('error', function(e) {
    if (e.code !== 'EADDRINUSE') throw e;
    net.connect({ path: socketPath }, function() {
        throw e;
    }).on('error', function(e) {
    if (e.code !== 'ECONNREFUSED') throw e;
        fs.unlinkSync(socketPath);
        pysocket.listen(socketPath);
    });
});

// Update keys
function updateKeys() {
    child.spawn('python', ['/var/cryptr/get.py']);
}
updateKeys();

//Run updateKeys() ever hour after starting the server
new CronJob('0 3 * * * *', function() { updateKeys(); }, null, true, 'America/Los_Angeles');



// =================== Cryptr Folder Storage ======================
// Initialize local storage
var localstorage = {};
try { localstorage = JSON.parse(fs.readFileSync('/var/cryptr/init.json', 'utf8')); }
catch(e) { fs.writeFile("/var/cryptr/init.json", "{}"); }


// =================== Configure PassportJS ======================
// Instruct Passport to use local strategy, and authenticate via LDAP manually
passport.use(new LocalStrategy(function(username, password, done) {
    var usercn = 'cn=' + username + ',' + ldapCN;
    var client = ldap.createClient({
        url: ldapURL,
        idleTimeout: 10000,
        connectTimeout: 10000,
        timeout: 10000
    });

    var p = Base64.decode(password);
    client.bind(usercn, p, function(err) {
        if (err !== null) {
            log.error('Bind Error', err);
            if (err.name == 'InvalidCredentialsError') return done(null, false, {status: 'error', message: 'Invalid Credentials.'});
            return done(null, false, {status: 'error', message: 'Bind error. See server logs for more details.'});
        }
        var opts = {
            filter: '(&(objectCategory=group)(' + ldapOU + '))',
            scope: 'sub'
        };
        client.search(ldapENTRY, opts, function(err, res) {
            res.on('searchEntry', function(entry) {
                var members = entry.object.member;
                for (var i = 0; i < members.length; i++) {
                    if (members[i].includes('CN=' + username + ',')) {
                        log.info('User ' + username + ' logged in.');
                        client.unbind();
                        return done(null, { username: username }, {});
                    }
                }
                log.error('User ' + username + ' is not a member of ' + ldapOU + '. Access denied.');
                // client.unbind();
                return done(null, false, {status: 'error', message: 'User ' + username + ' is not a member of ' + ldapOU + '. Access denied.'});
            });
            res.on('error', function(err) {
                log.error('Search Error ', err);
            });
        });
    });
}));

// Information to embed in the session cookie
passport.serializeUser(function(user, done) {
    done(null, user.username);
});
passport.deserializeUser(function(id, done) {
    done(null, { username: id });
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json())
app.use(cookieParser());
app.set('trust proxy', 1);
app.use(session({
    secret: crypto.lib.WordArray.random(128/8).toString(),
    name: 's',
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 600000,
    }
}));
app.use(passport.initialize());
app.use(passport.session());

function secure(req, res, next) {
    if (req.user) next();
    else res.status(401).send('Unauthorized Request.');
}



// =================== Routes ======================
// Request all keys
app.get('/request', secure, function (req, res) {
    var temp = {};
    temp.results = keysArray;
    temp.folders = Object.keys(localstorage);
    temp.folders.sort(function (a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    temp.folderdata = localstorage;
    temp.status = 'success';
    temp.keytime = keyTime;
    log.info('User ' + req.user.username + ' requested keys.');
    return res.json(temp);
});

// Refresh keys
app.get('/refresh', secure, function(req, res) {
    updateKeys();
    log.info('User ' + req.user.username + ' requested key refresh.');
    return res.json({
        status: 'success',
        message: 'Refreshing keys.'
    });
});

// Move keys to folder
app.post('/move', secure, function(req, res) {
    if (!req.body) {
        return res.json({
            status: 'error',
            message: 'No data provided.'
        });
    } else if (!req.body.dest){
        log.info('User ' + req.user.username + ' did not provide a destination to move keys.');
        return res.json({
            status: 'error',
            message: 'No destination provided.'
        });
    } else {
        if (!localstorage[req.body.dest]) localstorage[req.body.dest] = [];             // Create the 'folder' if it doesn't exist
        for (var key in req.body) {
            if (key != 'dest') localstorage[req.body.dest].push(req.body[key]);         // Add the hashes to the folder
        }
        var temp = new Set(localstorage[req.body.dest]);                                // Convert array to set, and back to array to clear duplicates
        localstorage[req.body.dest] = Array.from(temp);
        fs.writeFile("/var/cryptr/init.json", JSON.stringify(localstorage));            // Write changes to file
        log.info('User ' + req.user.username + ' moved keys: ', req.body);
        return res.json({
            status: 'success',
            message: 'Keys moved.'
        });
    }
});

// Remove keys from folder
app.post('/remove', secure, function(req, res) {
    if (!req.body) {
        return res.json({
            status: 'error',
            message: 'No data provided.'
        });
    } else if (!req.body.dest){
        log.info('User ' + req.user.username + ' did not provide a destination to move keys.');
        return res.json({
            status: 'error',
            message: 'No destination provided.'
        });
    } else if (!localstorage[req.body.dest]) {
        log.info('User ' + req.user.username + '. Folder does not exist.');
        return res.json({
            status: 'error',
            message: 'Folder does not exist.'
        });
    } else {
        for (var key in req.body) {
            if (key != 'dest') {
                var index = localstorage[req.body.dest].indexOf(req.body[key]);         // Remove the key from the folder, by value
                if (index != -1) localstorage[req.body.dest].splice(index, 1);
            }
        }
        fs.writeFile("/var/cryptr/init.json", JSON.stringify(localstorage));            // Write changes to file
        log.info('User ' + req.user.username + ' removed keys: ', req.body);
        return res.json({
            status: 'success',
            message: 'Keys removed.'
        });
    }
});

// Delete Folder
app.post('/deletefolder', secure, function(req, res) {
    if (!req.body) {
        return res.json({
            status: 'error',
            message: 'No data provided.'
        });
    } else if (!req.body.folder){
        log.info('User ' + req.user.username + ' did not provide a folder to delete.');
        return res.json({
            status: 'error',
            message: 'No folder provided.'
        });
    } else if (!localstorage[req.body.folder]) {
        log.info('User ' + req.user.username + '. Folder does not exist.');
        return res.json({
            status: 'error',
            message: 'Folder does not exist.'
        });
    } else {
        delete localstorage[req.body.folder];
        fs.writeFile("/var/cryptr/init.json", JSON.stringify(localstorage));            // Write changes to file
        log.info('User ' + req.user.username + ' deleted folder: ', req.body.folder);
        return res.json({
            status: 'success',
            message: 'Folder removed.'
        });
    }
});

// User logged in status
app.get('/status', secure, function(req, res) {
    return res.json({status: 'success', keytime: keyTime});
});

// Login
app.post('/auth', function(req, res, next) {
    passport.authenticate('local', function(err, user, info) {
		if (err) return next(err);
		if (!user) return res.json(info);
		req.logIn(user, function(error) {
			if (error) return next(error);
			return res.json({ status: 'success'});
		});
	})(req, res, next);
});

// Logout
app.get('/logout', secure, function(req, res) {
    req.logout();
    res.json({status: 'success'});
});


// =================== Start Server ======================
app.listen(3353, function () {
    log.info('Server started. Listening on port 3353.');
});
