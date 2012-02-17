# vim: ts=4 sw=4 expandtab
import HTMLParser
import unittest

class _Parser(HTMLParser.HTMLParser):
    def __init__(self):
        HTMLParser.HTMLParser.__init__(self)
        self._tags = []

    def handle_starttag(self, tag, attributes):
        if tag.lower() == 'script':
            attr = dict(attributes)
            self._tags.append({
                'type': 'start',
                'lineno': self.lineno,
                'offset': self.offset,
                'len': len(self.get_starttag_text()),
                'attr': attr
            })

    def handle_endtag(self, tag):
        if tag.lower() == 'script':
            self._tags.append({
                'type': 'end',
                'lineno': self.lineno,
                'offset': self.offset,
            })

    def unknown_decl(self, data):
        # Ignore unknown declarations instead of raising an exception.
        pass

    def gettags(self):
        return self._tags

def findscripttags(s):
    """ Note that the lineno is 1-based.
    """
    parser = _Parser()
    parser.feed(s)
    parser.close()
    return parser.gettags()

class TestHTMLParse(unittest.TestCase):
    def testConditionalComments(self):
        html = """
<!--[if IE]>This is Internet Explorer.<![endif]-->
<![if !IE]>This is not Internet Explorer<![endif]>
"""
        findscripttags(html)

