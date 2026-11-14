require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |spec|
  spec.name = 'PulseVpnEngine'
  spec.version = package['version']
  spec.summary = 'Native iOS VPN tunnel bridge for Pulse.'
  spec.description = 'Connects Pulse to its iOS Network Extension Packet Tunnel.'
  spec.license = { :type => 'GPL-3.0-only' }
  spec.author = 'Pulse'
  spec.homepage = 'https://github.com/axix20xx/Pulsev'
  spec.source = { :git => 'https://github.com/axix20xx/Pulsev.git', :tag => spec.version.to_s }
  spec.platforms = { :ios => '15.1' }
  spec.static_framework = true
  spec.dependency 'ExpoModulesCore'
  spec.source_files = 'ios/**/*.{h,m,mm,swift}'
  spec.frameworks = 'NetworkExtension', 'Security', 'Network', 'UIKit'
end
