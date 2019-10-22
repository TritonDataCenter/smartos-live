@Library('jenkins-joylib@v1.0.1') _

pipeline {

    agent none

    options {
        buildDiscarder(logRotator(numToKeepStr: '30'))
        timestamps()
    }

    parameters {
        string(
            name: 'PLAT_CONFIGURE_ARGS', trim: true,
            defaultValue: null,
            description:'''
Arguments to smartos-live's configure script:<br>
<dl>
<dt>-c</dt>
<dd>clobber Illumos before each build [default: no]</dd>
<dt>-d</dt>
<dd>build Illumos in DEBUG mode only [default: no]</dd>
<dt>-h</dt>
<dd>this message</dd>
<dt>-p gcc4</dt>
<dd>primary compiler version [default: gcc7]</dd>
<dt>-P password</dt>
<dd>platform root password [default: randomly chosen]</dd>
<dt>-r</dt>
<dd>full strap build (no cache) [default: no]</dd>
<dt>-S</dt>
<dd>do *not* run smatch [default is to run smatch]</dd>
<dt>-s gcc7</dt>
<dd>shadow compilers, comma delimited (gcc4,gcc#) [default: none]</dd>
</dl>
'''
        )

        string(
            name: 'CONFIGURE_PROJECTS', trim: true,
            defaultValue: '''
illumos-extra: master: origin
illumos: master: origin
local/kvm-cmd: master: origin
local/kvm: master: origin
local/mdata-client: master: origin
local/ur-agent: master: origin''',
            description:'''
This parameter is used by smartos-live to decide which branches to checkout and configure.

The string is formatted<br/>

<pre>
&lt;relative path to ./projects&gt;:&lt;branch name&gt;:[optional git URL]
</pre>

In place of a full git url, the keywords 'origin' and 'cr' are allowed
in order to specify the default github or cr.joyent.us git remote URLs.
'''
        )

        choice(
            name: 'PLATFORM_BUILD_FLAVOR',
            choices: ['triton',
                      'smartos',
                      'triton-and-smartos'],
            description: '''
<dl>
  <dt>triton</dt><dd>the default, build a platform image and publish it</dd>
  <dt>smartos</dt><dd>build a platform image and smartos artifacts, but do not publish a Triton platform image</dd>
  <dt>triton-and-smartos</dt><dd>build both of the above</dd>
</dl>

The following are the SmartOS artifacts that will be published when selecting one of the smartos options:

<ul>
  <li>SmartOS iso image</li>
  <li>SmartOS usb image</li>
  <li>SmartOS vmware image</li>
  <li>SmartOS Changelog file</li>
</ul>''')

    }


    stages {
        // TODO: This fails with ls: cannot access 'projects/local': No such
        // file or directory, is there any linting we can do before building?
        // stage('check') {
        //     agent {
        //         label 'platform:true && image_ver:18.4.0 && pkgsrc_arch:x86_64 && dram:8gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:2'
        //     }
        //     steps{
        //         sh('make check')
        //     }
        // }

        stage('parallel') {
            parallel {
                stage('platform') {
                    agent {
                        label 'platform:true && image_ver:18.4.0 && pkgsrc_arch:x86_64 && dram:8gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:2'
                    }
                    stages {
                        stage('build-platform') {
                            steps{
                                sh('''
set -o errexit
set -o pipefail

export ENGBLD_BITS_UPLOAD_IMGAPI=true
./tools/build_jenkins''')
                            }
                        }
                    // TODO: Does archiving artifacts with the same pattern from
                    // multiple agents aggravate the way we want?
                    stage('archive') {
                        steps {
                            archiveArtifacts artifacts: 'projects/illumos/log/log.*/*,log/*,output/bits/artifacts.txt,output/gitstatus.json,output/changelog.txt', onlyIfSuccessful: true
                            }
                        }
                    }
                }

                stage('platform-debug') {
                    agent {
                        label 'platform:true && image_ver:18.4.0 && pkgsrc_arch:x86_64 && dram:8gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:2'
                    }
                    stages {
                        stage('build:debug') {
                            steps{
                                sh('''
set -o errexit
set -o pipefail

# We explicitly do not want debug bits going to the 'dev' channel
# on updates.joyent.com. They will still appear on /Joyent_Dev/public/builds/debug
# export ENGBLD_BITS_UPLOAD_IMGAPI=true

./tools/build_jenkins -d''')
                            }
                        }
                        stage('archive') {
                            steps {
                                archiveArtifacts artifacts: 'projects/illumos/log/log.*/*,log/*,output/bits/artifacts.txt,output/gitstatus.json,output/changelog.txt', onlyIfSuccessful: true
                            }
                        }
                    }
                }

                stage('platform-gcc4') {
                    agent {
                        label 'platform:true && image_ver:18.4.0 && pkgsrc_arch:x86_64 && dram:8gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:2'
                    }
                    stages {
                        stage('build:gcc4') {
                            steps{
                                sh('''
set -o errexit
set -o pipefail

export PLAT_CONFIGURE_ARGS="-p gcc4 $PLAT_CONFIGURE_ARGS"

# enough to make sure we don't pollute the main Manta dir
export PLATFORM_DEBUG_SUFFIX=-gcc4

export ENGBLD_BITS_UPLOAD_IMGAPI=true
./tools/build_jenkins''')
                            }
                        }
                        stage('archive') {
                            steps {
                                archiveArtifacts artifacts: 'projects/illumos/log/log.*/*,log/*,output/bits/artifacts.txt,output/gitstatus.json,output/changelog.txt', onlyIfSuccessful: true
                            }
                        }
                    }
                }

                stage('platform-strap-cache') {
                    agent {
                        label 'platform:true && image_ver:18.4.0 && pkgsrc_arch:x86_64 && dram:8gb && !virt:kvm && fs:pcfs && fs:ufs && jenkins_agent:2'
                    }
                    stages {
                        stage('build:strap-cache') {
                            steps{
                                sh('''
set -o errexit
set -o pipefail

env

git checkout origin/master
git clean -fdx

echo "illumos-extra: master: origin" >configure-projects
echo "illumos: master: origin" >>configure-projects

./configure

git -C projects/illumos pull
git -C projects/illumos-extra pull
git -C projects/illumos-extra clean -fdx

mloc=$(make strap-cache-location)

if mls $mloc >/dev/null; then
	echo "$mloc exists; skipping build"
    exit 0
fi

make strap-cache

mput -pf output/proto.strap.tgz ${mloc}''')
                            }
                        }
                    }
                }
            }
        }
    }

    post {
        always {
            joyMattermostNotification()
        }
    }
}
