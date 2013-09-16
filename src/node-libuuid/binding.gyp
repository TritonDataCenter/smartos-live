{
    'conditions': [
        ['OS=="solaris"', {
            'targets': [
                {
                    'target_name': 'uuid',
                    'sources': [ 'src/uuid.cc' ],
                    'libraries': [ '-luuid' ],
                    'conditions': [
                        ['target_arch=="ia32"', {
                             'ldflags': [ '-L/opt/omni/lib -R/opt/omni/lib' ]
                        }],
                        ['target_arch=="x64"', {
                             'ldflags': [ '-L/opt/omni/lib/amd64 -R/opt/omni/lib/amd64' ]
                        }]
                     ]
                }
            ]
        }],
        ['OS!="solaris"', {
            'targets': [
                {
                    'target_name': 'uuid',
                    'sources': [ 'src/uuid.cc' ],
                }
            ]
        }]
    ]
}
