/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

@Library('jenkins-joylib@v1.0.2') _

pipeline {

    agent {
        label 'platform:true && image_ver:18.4.0 && pkgsrc_arch:x86_64 && ' +
            'dram:8gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:2'
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '30'))
        timestamps()
    }

    parameters {
        string(
            name: 'PLAT_CONFIGURE_ARGS',
            defaultValue: '',
            description:
                'Arguments to smartos-live\'s configure script:<br>\n' +
                '<dl>\n' +
                '<dt>-c</dt>\n' +
                '<dd>clobber Illumos before each build [default: no]</dd>\n' +
                '<dt>-d</dt>\n' +
                '<dd>build Illumos in DEBUG mode only [default: no]</dd>\n' +
                '<dt>-h</dt>\n' +
                '<dd>this message</dd>\n' +
                '<dt>-p gcc4</dt>\n' +
                '<dd>primary compiler version [default: gcc7]</dd>\n' +
                '<dt>-P password</dt>\n' +
                '<dd>platform root password [default: randomly chosen]</dd>\n' +
                '<dt>-r</dt>\n' +
                '<dd>full strap build (no cache) [default: no]</dd>\n' +
                '<dt>-S</dt>\n' +
                '<dd>do *not* run smatch [default is to run smatch]</dd>\n' +
                '<dt>-s gcc7</dt>\n' +
                '<dd>shadow compilers, comma delimited (gcc4,gcc#) [default: none]</dd>\n' +
                '</dl>'
        )
        text(
            name: 'CONFIGURE_PROJECTS',
            defaultValue:
                'illumos-extra: master: origin\n' +
                'illumos: master: origin\n' +
                'local/kvm-cmd: master: origin\n' +
                'local/kvm: master: origin\n' +
                'local/mdata-client: master: origin\n' +
                'local/ur-agent: master: origin',
            description:
                'This parameter is used by smartos-live to decide ' +
                'which branches to checkout and configure.</br>\n' +
                'The string is formatted:<br/>' +
                '<pre>\n' +
                '&lt;relative path to ./projects&gt;:&lt;branch name&gt;:[optional git URL]\n' +
                '</pre>' +
                'In place of a full git url, the keyword \'origin\' ' +
                'is allowed in order to specify the default github remote URL.'
        )
        // The default choice() is the first list item
        choice(
            name: 'PLATFORM_BUILD_FLAVOR',
            choices: ['triton', 'smartos', 'triton-and-smartos'],
            description:
                '<dl>\n' +
                '<dt>triton</dt>' +
                  '<dd>the default, build a platform image and publish it</dd>\n' +
                '<dt>smartos</dt>' +
                  '<dd>build a platform image and smartos artifacts, but do ' +
                  'not publish a Triton platform image</dd>\n' +
                '<dt>triton-and-smartos</dt>' +
                  '<dd>build both of the above</dd>\n' +
                '</dl>' +
                'The following are the SmartOS artifacts that will be ' +
                'published when selecting one of the smartos options: ' +
                '<ul>\n' +
                '  <li>SmartOS iso image</li>\n' +
                '  <li>SmartOS usb image</li>\n' +
                '  <li>SmartOS vmware image</li>\n' +
                '  <li>SmartOS Changelog file</li>\n' +
                '</ul>'
        )
    }
    stages {
        // Jenkins PR builds defaults to a lightweight checkout, which
        // doesn't include all branch information, which causes the
        // smartos-live ./tools/build_changelog script to fail, breaking
        // the build. Get those branches before doing anything.
        stage('get-all-branches') {
            steps{
                sh("git fetch origin '+refs/heads/*:refs/remotes/origin/*'")
            }
        }
        stage('get-causes') {
           steps {
               script {
                   import groovy.json.JsonOutput
                   def causes = currentBuild.getBuildCauses()
                   echo JsonOutput.prettyPrint(causes)
               }
           }
        }
        stage('check') {
            steps{
                sh('''
set -o errexit
set -o pipefail
./tools/build_jenkins -C
''')
            }
        }
        // in case 'make check' left anything hanging around
        stage('re-clean') {
            steps {
                sh('git clean -fdx')
            }
        }
        stage('build image and upload') {
            when {
                not {
                    changeRequest() 
                }
            }
            steps {
                sh('''
set -o errexit
set -o pipefail

export ENGBLD_BITS_UPLOAD_IMGAPI=true
./tools/build_jenkins
''')
            }
        }
    }
    post {
        always {
            joyMattermostNotification(channel: 'jenkins')
            archiveArtifacts artifacts: 'projects/illumos/log/log.*/*,' +
                'log/*,output/bits/artifacts.txt,' +
                'output/gitstatus.json,' +
                'output/changelog.txt'
        }
    }
}
