cmake_minimum_required(VERSION 3.22.1)
project(harp2tab-audio)
add_library(harp2tab-audio SHARED AudioEngine.cpp)
target_link_libraries(harp2tab-audio log android)
