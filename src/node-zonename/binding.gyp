{
    "targets": [
        {
            "target_name": "zonename",
            "include_dirs" : [ "<!(node -e \"require('nan')\")" ],
            "sources": [
                "src/zonename.cc"
            ]
        }
    ]
}

