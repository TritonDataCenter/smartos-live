/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2022 Joyent, Inc.
 * Copyright 2023 MNX Cloud, Inc.
 */

@Library('jenkins-joylib@v1.0.8') _

pipeline {

    options {
        buildDiscarder(logRotator(numToKeepStr: '30'))
        timestamps()
        parallelsAlwaysFailFast()
    }
    // Don't assign a specific agent for the entire job, in order to better
    // share resources across jobs. Otherwise, we'd tie up an agent here for
    // the duration of all stages for a given build, despite it not doing any
    // actual work.
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
                '<dt>-p gcc10</dt>\n' +
                '<dd>primary compiler version [default: gcc10]</dd>\n' +
                '<dt>-P password</dt>\n' +
                '<dd>platform root password [default: randomly chosen]</dd>\n' +
                '<dt>-S</dt>\n' +
                '<dd>do *not* run smatch [default is to run smatch]</dd>\n' +
                '<dt>-s gcc7</dt>\n' +
                '<dd>shadow compilers, comma delimited (gcc7,gcc#) [default: none]</dd>\n' +
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
                '<p><dl>\n' +
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
                '</ul></p>'
        )
        booleanParam(
            name: 'BUILD_STRAP_CACHE',
            defaultValue: false,
            description: 'This parameter declares whether to build and ' +
                'upload a new strap-cache as part of this build. This ' +
                'should only be true when triggered by a push to illumos-extra.'
        )
        booleanParam(
            name: 'ONLY_BUILD_STRAP_CACHE',
            defaultValue: false,
            description: '<p>This parameter declares that this build should ' +
                '<b>only</b> build and upload the strap cache tarball. This ' +
                'is useful in cases where a push to illumos-extra coincides ' +
                'with an otherwise broken platform build.</p>'
        )
    }
    stages {
        stage('check') {
            agent {
                node {
                    label 'platform:true && image_ver:21.4.0 && pkgsrc_arch:x86_64 && ' +
                    'dram:16gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:3'
                    customWorkspace "workspace/smartos-${BRANCH_NAME}-check"
                }
            }
            steps{
                sh('''
set -o errexit
set -o pipefail
./tools/build_jenkins -c -F check
                ''')
            }
            post {
                // We don't notify here, as that doesn't add much
                // value. The checks should always pass, and it's unlikely
                // that developers will care when they do. If they don't
                // pass, then the (likely) GitHub PR will be updated with a
                // failure status, and the developer can then investigate.

                // https://jenkins.io/doc/pipeline/steps/ws-cleanup/
                // We don't clean on build failure so that there's a chance to
                // investigate the breakage. Hopefully, a subsequent successful
                // build will then clean up the workspace, though that's not
                // guaranteed for abandoned branches.
                always {
                    cleanWs cleanWhenSuccess: true,
                        cleanWhenFailure: false,
                        cleanWhenAborted: true,
                        cleanWhenNotBuilt: true,
                        deleteDirs: true
                }
            }
        }
	stage('build-variants') {
        parallel {
            stage('default') {
                agent {
                    // There seems to be a Jenkins bug where ${WORKSPACE} isn't
                    // resolved at the time of node declaration, so we can't reuse
                    // that when setting our custom workspace for each separate
                    // pipeline stage (to allow users the chance of inspecting
                    // workspaces from different pipeline stages after the build
                    // completes).
                    // Use ${BRANCH_NAME} instead.
                    node {
                        label 'platform:true && image_ver:21.4.0 && pkgsrc_arch:x86_64 && ' +
                        'dram:16gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:3'
                        customWorkspace "workspace/smartos-${BRANCH_NAME}-default"
                    }
                }
                when {
                    // We only want to trigger most pipeline stages on either a
                    // push to master, or an explicit build request from a user.
                    // Otherwise, every push to a PR branch would cause a build,
                    // which might be excessive. The exception is the 'check' stage
                    // above, which is ~ a 2 minute build.
                    beforeAgent true
                    allOf {
                        anyOf {
                            branch 'master'
                            triggeredBy cause: 'UserIdCause'
                        }
                        environment name: 'ONLY_BUILD_STRAP_CACHE', value: 'false'
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
                }
                post {
                    always {
                        archiveArtifacts artifacts: 'output/default/**',
                            onlyIfSuccessful: false,
                            allowEmptyArchive: true
                        cleanWs cleanWhenSuccess: true,
                            cleanWhenFailure: false,
                            cleanWhenAborted: true,
                            cleanWhenNotBuilt: true,
                            deleteDirs: true
                        joySlackNotifications(
                            channel: 'smartos', comment: 'default')
                    }
                }
            }
            stage('debug') {
                agent {
                    node {
                        label 'platform:true && image_ver:21.4.0 && pkgsrc_arch:x86_64 && ' +
                            'dram:16gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:3'
                        customWorkspace "workspace/smartos-${BRANCH_NAME}-debug"
                    }
                }
                when {
                    beforeAgent true
                    allOf {
                        anyOf {
                            branch 'master'
                            triggeredBy cause: 'UserIdCause'
                        }
                        // If a user has set PLAT_CONFIGURE_ARGS, that
                        // suggests we may have been asked for a special debug, or
                        // gcc, etc. build. In that case, don't bother building
                        // any stages which may duplicate the arguments they
                        // specified. The same goes for the rest of the pipeline
                        // stages.
                        environment name: 'PLAT_CONFIGURE_ARGS', value: ''
                        environment name: 'ONLY_BUILD_STRAP_CACHE', value: 'false'
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
                }
                post {
                    always {
                        archiveArtifacts artifacts: 'output/debug/**',
                            onlyIfSuccessful: false,
                            allowEmptyArchive: true
                        cleanWs cleanWhenSuccess: true,
                            cleanWhenFailure: false,
                            cleanWhenAborted: true,
                            cleanWhenNotBuilt: true,
                            deleteDirs: true
                        joySlackNotifications(
                            channel: 'smartos', comment: 'debug')
                    }
                }
            }
            stage('gcc7') {
                agent {
                    node {
                        label 'platform:true && image_ver:21.4.0 && pkgsrc_arch:x86_64 && ' +
                            'dram:16gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:3'
                        customWorkspace "workspace/smartos-${BRANCH_NAME}-gcc7"
                    }
                }
                when {
                    beforeAgent true
                    allOf {
                        anyOf {
                            branch 'master'
                            triggeredBy cause: 'UserIdCause'
                        }
                        environment name: 'PLAT_CONFIGURE_ARGS', value: ''
                        environment name: 'ONLY_BUILD_STRAP_CACHE', value: 'false'
                    }
                }
                steps {
                    sh('git clean -fdx')
                    sh('''
export PLAT_CONFIGURE_ARGS="-p gcc7 -r $PLAT_CONFIGURE_ARGS"
# enough to make sure we don't pollute the main Manta dir
# Also for now we implicitly promise that the gcc7 deliverables are DEBUG,
# but we could choose to make -gcc7 *and* -debug-gcc7 stages later and alter
# PLATFORM_DEBUG_SUFFIX accordingly.
export PLATFORM_DEBUG_SUFFIX=-gcc7
./tools/build_jenkins -c -d -S gcc7
                    ''')
                }
                post {
                    always {
                        archiveArtifacts artifacts: 'output/gcc7/**',
                            onlyIfSuccessful: false,
                            allowEmptyArchive: true
                        cleanWs cleanWhenSuccess: true,
                            cleanWhenFailure: false,
                            cleanWhenAborted: true,
                            cleanWhenNotBuilt: true,
                            deleteDirs: true
                        joySlackNotifications(
                            channel: 'smartos', comment: 'gcc7')
                    }
                }
            }
            stage('strap-cache') {
                agent {
                    node {
                        label 'platform:true && image_ver:21.4.0 && pkgsrc_arch:x86_64 && ' +
                            'dram:16gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:3'
                        customWorkspace "workspace/smartos-${BRANCH_NAME}-strap-cache"
                    }
                }
                when {
                    beforeAgent true
                    // We only build strap-cache as a result of a push to
                    // illumos-extra. See the Jenkinsfile in that repository
                    // which has a build(..) step for smartos-live that sets
                    // this environment value.
                    anyOf {
                        environment name: 'BUILD_STRAP_CACHE', value: 'true'
                        environment name: 'ONLY_BUILD_STRAP_CACHE', value: 'true'
                    }
                }
                steps {
                    sh('git clean -fdx')
                    sh('''
set -o errexit
set -o pipefail
export MANTA_TOOLS_PATH=/root/bin/
./tools/build_jenkins -c -F strap-cache -S strap-cache
                    ''')
                }
                post {
                    always {
                        archiveArtifacts artifacts: 'output/strap-cache/**',
                            onlyIfSuccessful: false,
                            allowEmptyArchive: true
                        cleanWs cleanWhenSuccess: true,
                            cleanWhenFailure: false,
                            cleanWhenAborted: true,
                            cleanWhenNotBuilt: true,
                            deleteDirs: true
                        joySlackNotifications(
                            channel: 'smartos', comment: 'strap-cache')
                    }
                }
            }
	}
	}
    }
    post {
        always {
            joySlackNotifications(
                channel: 'jenkins', comment: 'pipeline complete')
            joySlackNotifications(
                channel: 'smartos', comment: 'pipeline complete')
        }
    }
}
