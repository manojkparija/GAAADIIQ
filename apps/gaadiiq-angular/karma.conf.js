// Karma configuration for gaadiiq-angular.
//
// Adds a ChromeHeadlessCI launcher: containers and CI runners execute as root,
// where Chrome refuses to start without --no-sandbox.
//
//   npm test -- --browsers=ChromeHeadlessCI --watch=false

module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    client: {
      jasmine: {},
      clearContext: false, // leave the Jasmine spec runner visible in the browser
    },
    jasmineHtmlReporter: {
      suppressAll: true, // collapse duplicated traces
    },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/gaadiiq-angular'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['Chrome'],
    customLaunchers: {
      ChromeHeadlessCI: {
        base: 'ChromeHeadless',
        flags: [
          '--no-sandbox',            // required when running as root in a container
          '--disable-gpu',
          '--disable-dev-shm-usage', // avoid /dev/shm exhaustion on small runners
        ],
      },
    },
    restartOnFileChange: true,
  });
};
