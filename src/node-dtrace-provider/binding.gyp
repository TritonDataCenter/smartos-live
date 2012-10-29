{
    'targets': [
        {
            'target_name': 'DTraceProviderBindings',
            'conditions': [
                ['OS=="mac" or OS=="solaris" or OS=="freebsd"', {
                    'sources': [
	                'dtrace_provider.cc',
	                'dtrace_probe.cc',
                    ],
                    'include_dirs': [
	                'libusdt'
                    ],
                    'dependencies': [
                        'libusdt'
                    ],
                    'libraries': [
                        '-L<(module_root_dir)/libusdt -l usdt'
                    ]
                }]
            ]
        },
        {
            'target_name': 'libusdt',
            'type': 'none',
            'conditions': [
                ['OS=="mac" or OS=="solaris" or OS=="freebsd"', {
                    'actions': [{
                        'inputs': [''],
                        'outputs': [''],
                        'action_name': 'build_libusdt',
	      	        'action': [
                            'sh', 'libusdt-build.sh'
		        ]
	            }]
                }]
            ]
        }
    ]
}
