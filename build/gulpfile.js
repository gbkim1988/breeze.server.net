// Build for breeze.server.net

// include gulp
var gulp = require('gulp');

var fs   = require('fs');
var path = require('path');
var glob = require('glob');
var async = require('async');
var del = require('del');
var eventStream = require('event-stream');

// include plug-ins
var gutil = require('gulp-util');
var flatten = require('gulp-flatten');

//var concat  = require('gulp-concat');
//var rename  = require('gulp-rename');
//var newer   = require('gulp-newer');

var _tempDir = './_temp/';
var _jsSrcDir = '../../Breeze.js/src/'
var _jsBuildDir = '../../Breeze.js/build/';
var _nugetDir = '../Nuget.builds/'
// var _msBuildCmd = 'C:/Windows/Microsoft.NET/Framework/v4.0.30319/MSBuild.exe ';
var _msBuildCmd = '"C:/Program Files (x86)/MSBuild/12.0/Bin/MsBuild.exe" '; // vs 2013 version of MsBuild
var _msBuildOptions = ' /p:Configuration=Release /verbosity:minimal ';

var _versionNum = getBreezeVersion();
gutil.log('LocalAppData dir: ' + process.env.LOCALAPPDATA);

// copy production versions of the breeze.*.js files into the nuget breeze.client.
gulp.task("copyBreezeJs", ['breezeClientBuild'], function() {
  return gulp.src( mapPath( _jsBuildDir, [ 'breeze.*.js' ]))
    .pipe(gulp.dest(_nugetDir + 'Breeze.Client/content/scripts'));
});

gulp.task('breezeClientBuild', function(done) {
  execCommands(['gulp'], { cwd: _jsBuildDir }, done);
});

// look for all .dll files in the nuget dir and try to find
// the most recent production version of the same file and copy
// it if found over the one in the nuget dir.
gulp.task("copyDlls", ['breezeServerBuild'], function() {
  gutil.log('copying dlls...')
  var fileNames = glob.sync(_nugetDir + '**/*.dll');
  var streams = [];
  fileNames.forEach(function(fileName) {
    var baseName = path.basename(fileName, '.dll');
    var src = '../' + baseName +  '/bin/release/' + baseName + '.dll'
    if (fs.existsSync(src)) {
      var dest = path.dirname(fileName);
      gutil.log("Processing " + fileName);
      streams.push(gulp.src(src).pipe(gulp.dest(dest)));
    } else {
      gutil.log("skipped: " + src);
    }
  });
  return eventStream.concat.apply(null, streams);
});

gulp.task('breezeServerBuild', function(done) {
  var solutionFileName = '../Breeze.Build.sln';
  msBuildSolution(solutionFileName, done);
});

gulp.task('nugetClean', function() {
  var src = _nugetDir + '**/*.nupkg';
  del.sync(src, { force: true} );
//  return gulp.src(src, { read: false }) // much faster
//      .pipe(rimraf());
});

gulp.task('nugetPack', ['copyBreezeJs', 'copyDlls', 'nugetClean'], function(done) {
  gutil.log('Packing nugets...');
  var fileNames = glob.sync(_nugetDir + '**/Default.nuspec');
  async.each(fileNames, function (fileName, cb) {
    packNuget(fileName, cb);
  }, done);
});

gulp.task('nugetTestDeploy', ['nugetPack'], function() {
  var src = _nugetDir + '**/*.nupkg';
  var dest = process.env.LOCALAPPDATA + '/Nuget/Cache'
  return gulp.src(src)
      .pipe(flatten())
      .pipe(gulp.dest(dest));
});

// should ONLY be called manually after testing locally installed nugets from nugetPack step.
// deliberately does NOT have a dependency on nugetPack
gulp.task('nugetDeploy', function(done) {
  gutil.log('Deploying Nugets...');
  var src = _nugetDir + '**/*.nupkg';
  var fileNames = glob.sync( src);
  async.each(fileNames, function (fileName, cb) {
    gutil.log('Deploying nuspec file: ' + fileName);
    var cmd = 'nuget push ' + fileName;
    execCommands([ cmd], null, cb);
  }, done);

});

gulp.task('default', ['nugetTestDeploy'] , function() {

});

function packNuget(nuspecFileName, execCb) {
  var folderName = path.dirname(nuspecFileName);
  var text = fs.readFileSync(nuspecFileName, { encoding: 'utf8'});
  var folders = folderName.split('/');
  var folderId = folders[folders.length-1];

  text = text.replace(/{{version}}/g, _versionNum);
  text = text.replace(/{{id}}/g, folderId);
  var destFileName = folderName + '/' + folderId + '.nuspec';
  gutil.log('Packing nuspec file: ' + destFileName);
  fs.writeFileSync(destFileName, text);
  // 'nuget pack $folderName.nuspec'
  var cmd = 'nuget pack ' + folderId + '.nuspec'
  execCommands([ cmd], { cwd: folderName }, execCb);
}

function getBreezeVersion() {
  var versionFile = fs.readFileSync( _jsSrcDir + '_head.jsfrag');
  var regex = /\s+version:\s*"(\d.\d\d*.?\d*.?\d*)"/
  var matches = regex.exec(versionFile);

  if (matches == null) {
    throw new Error('Breeze client version number not found');
  }
  // matches[0] is entire version string - [1] is just the capturing group.
  var versionNum = matches[1];
  gutil.log("Breeze client version from: " + _jsSrcDir + ' is: ' + versionNum);
  return versionNum;
}



function msBuildSolution(solutionFileName, done) {
  if (!fs.existsSync(solutionFileName)) {
    throw new Error(solutionFileName + ' does not exist');
  }
  var baseName = path.basename(solutionFileName);
  var rootCmd = _msBuildCmd + '"' + baseName +'"' + _msBuildOptions + ' /t:'

  var cmds = [rootCmd + 'Clean', rootCmd + 'Rebuild'];
  var cwd = path.dirname(solutionFileName);
  execCommands(cmds, { cwd: cwd},  done);
}


// utilities
// added options are: shouldLog
// cb is function(err, stdout, stderr);
function execCommands(cmds, options, cb) {
  options = options || {};
  options.shouldThrow = options.shouldThrow == null ? true : options.shouldThrow;
  options.shouldLog = options.shouldLog == null ? true : options.shouldLog;
  if (!cmds || cmds.length == 0) cb(null, null, null);
  var exec = require('child_process').exec;  // just to make it more portable.
  exec(cmds[0], options, function(err, stdout, stderr) {
    if (err == null) {
      if (options.shouldLog) {
        gutil.log('cmd: ' + cmds[0]);
        gutil.log('stdout: ' + stdout);
      }
      if (cmds.length == 1) {
        cb(err, stdout, stderr);
      } else {
        execCommands(cmds.slice(1), options, cb);
      }
    } else {
      if (options.shouldLog) {
        gutil.log('exec error on cmd: ' + cmds[0]);
        gutil.log('exec error: ' + err);
        if (stdout) gutil.log('stdout: ' + stdout);
        if (stderr) gutil.log('stderr: ' + stderr);
      }
      if (err && options.shouldThrow) throw err;
      cb(err, stdout, stderr);
    }
  });
}

function mapPath(dir, fileNames) {
  return fileNames.map(function(fileName) {
    return dir + fileName;
  });
};
