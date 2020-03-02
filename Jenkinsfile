/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

@Library('jenkins-joylib@v1.0.4') _

pipeline {

    options {
        buildDiscarder(logRotator(numToKeepStr: '30'))
        timestamps()
        parallelsAlwaysFailFast()
    }
    // Don't assign a specific agent for the entire job, in order to better
    // share resources between jobs. Otherwise, we'd tie up an agent here for
    // the duration of all stages for a given build.
    agent none

    parameters {
        string(
            name: 'PLAT_CONFIGURE_ARGS',
            defaultValue: '',
            description:
                'Arguments to smartos-live\'s configure script.\n' +
                'By setting any of these, we only run the <b>"default"</b>\n' +
                'Jenkins pipeline stage using the user-supplied value.<br/>' +
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
                'local/kbmd: master: origin\n' +
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
        booleanParam(
            name: 'BUILD_STRAP',
            defaultValue: false,
            description: 'This parameter declares whether to build a new ' +
                'strap-cache as part of this build. This should only be ' +
                'true when triggered by a push to illumos-extra.'
        )
    }
    stages {
        stage('check') {
            agent {
                label 'platform:true && image_ver:18.4.0 && pkgsrc_arch:x86_64 && ' +
                'dram:8gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:2'
            }
            steps{
                // Jenkins PR builds default to a lightweight checkout, which
                // doesn't include all branch information, which causes the
                // smartos-live ./tools/build_changelog script to fail, breaking
                // the build. Get those branches before doing anything.
                sh("git fetch origin '+refs/heads/*:refs/remotes/origin/*'")
                sh('''
set -o errexit
set -o pipefail
./tools/build_jenkins -c -F check
                ''')
            }
        }
        stage('default') {
            agent {
                label 'platform:true && image_ver:18.4.0 && pkgsrc_arch:x86_64 && ' +
                'dram:8gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:2'
            }
            when {
                anyOf {
                    branch 'master'
                    triggeredBy cause: 'UserIdCause'
                }
            }
            steps {
                sh('git clean -fdx')
                sh('''
set -o errexit
set -o pipefail
export ENGBLD_BITS_UPLOAD_IMGAPI=true
./tools/build_jenkins -c -S default
                ''')
                archiveArtifacts artifacts: 'output/default',
                    onlyIfSuccessful: false,
                    allowEmptyArchive: true
                joyMattermostNotification(channel: 'jenkins')
            }
        }
        stage('debug') {
            agent {
                node {
                label 'platform:true && image_ver:18.4.0 && pkgsrc_arch:x86_64 && ' +
                    'dram:8gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:2'
                customWorkspace "${env.WORKSPACE}-debug"
                }
            }
            when {
                allOf {
                    anyOf {
                        branch 'master'
                        triggeredBy cause: 'UserIdCause'
                    }
                    environment name: 'PLAT_CONFIGURE_ARGS', value: ''
                }
            }
            steps {
                sh('git clean -fdx')
                sh('''
set -o errexit
set -o pipefail
export PLAT_CONFIGURE_ARGS="-d $PLAT_CONFIGURE_ARGS"
./tools/build_jenkins -c -d -S debug
            ''')
                archiveArtifacts artifacts: 'output/debug',
                    onlyIfSuccessful: false,
                    allowEmptyArchive: true
                joyMattermostNotification(channel: 'jenkins')
            }
        }
        stage('gcc4') {
            agent {
                node {
                label 'platform:true && image_ver:18.4.0 && pkgsrc_arch:x86_64 && ' +
                    'dram:8gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:2'
                customWorkspace "${env.WORKSPACE}-gcc4"
                }
            }
            when {
                allOf {
                    anyOf {
                        branch 'master'
                        triggeredBy cause: 'UserIdCause'
                    }
                    environment name: 'PLAT_CONFIGURE_ARGS', value: ''
                }
            }
            steps {
                sh('git clean -fdx')
                sh('''
export PLAT_CONFIGURE_ARGS="-p gcc4 -r $PLAT_CONFIGURE_ARGS"
# enough to make sure we don't pollute the main Manta dir
export PLATFORM_DEBUG_SUFFIX=-gcc4
./tools/build_jenkins -c -d -S gcc4
                ''')
                archiveArtifacts artifacts: 'output/gcc4',
                    onlyIfSuccessful: false,
                    allowEmptyArchive: true
            }
        }
        stage('strap-cache') {
            agent {
                node {
                label 'platform:true && image_ver:18.4.0 && pkgsrc_arch:x86_64 && ' +
                    'dram:8gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:2'
                customWorkspace "${env.WORKSPACE}-strap-cache"
                }
            }
            when {
                // We only build strap-cache as a result of a push to
                // illumos-extra. See the Jenkinsfile in that repository
                // which has a build(..) step for smartos-live
                environment name: 'BUILD_STRAP', value: 'true'
            }
            steps {
                sh('git clean -fdx')
                sh('''
set -o errexit
set -o pipefail
export MANTA_TOOLS_PATH=/root/bin/
./tools/build_jenkins -c -F strap-cache -S strap-cache
                ''')
                archiveArtifacts artifacts: 'output/strap-cache',
                    onlyIfSuccessful: false,
                    allowEmptyArchive: true
                joyMattermostNotification(channel: 'jenkins')
            }
        }
    }
    post {
        always {
            joyMattermostNotification(channel: 'jenkins')
        }
    }
}
